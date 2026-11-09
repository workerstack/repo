import { z } from "zod";
import {
  ENCODED_SLASH,
  NOT_A_DOCUMENT,
  NOT_FOUND,
  REGISTRY,
  SCOPE_SLASH,
  WAIT_GIVE_UP_MINUTES,
  WAIT_GIVE_UP_MS,
  WAIT_POLL_MS,
} from "./release.constants.ts";
import { WAIT_PREFIX, WAIT_USAGE, notOnNpm, published } from "./release-messages.constants.ts";

/** Where `repo release wait` prints and what it reaches the registry, the clock and the sleep through. */
export type WaitIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  fetch: (url: string) => Promise<Response>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

/** The part of the registry's document for a package that a release reads. */
type RegistryDoc = { versions: Record<string, unknown>; "dist-tags": Record<string, string> };

const documentSchema = (): z.ZodType<RegistryDoc> =>
  z.object({ versions: z.record(z.string(), z.unknown()), "dist-tags": z.record(z.string(), z.string()) });

/** A package name and the version of it a tag or `wait` names. */
export type Spec = { name: string; version: string };

/** `<name>@<version>` split at its last `@` (a scope's `@` leads the name); null when there is no version. */
export function splitSpec(spec: string): Spec | null {
  const at = spec.lastIndexOf("@");
  return at > 0 && at < spec.length - 1 ? { name: spec.slice(0, at), version: spec.slice(at + 1) } : null;
}

/** What the registry said about a package: its document, that it is not there (404), or why it did not answer. */
export type RegistryAnswer =
  | { kind: "found"; doc: RegistryDoc }
  | { kind: "missing" }
  | { kind: "unreachable"; why: string };

/** Asks the registry for `name`; any answer but a document or a 404 is `unreachable` with its status or error. */
export async function registryDoc(fetcher: WaitIo["fetch"], name: string): Promise<RegistryAnswer> {
  try {
    const response = await fetcher(`${REGISTRY}${name.replace(SCOPE_SLASH, ENCODED_SLASH)}`);
    if (response.status === NOT_FOUND) return { kind: "missing" };
    if (!response.ok) return { kind: "unreachable", why: `HTTP ${response.status}` };
    const parsed = documentSchema().safeParse(await response.json());
    return parsed.success ? { kind: "found", doc: parsed.data } : { kind: "unreachable", why: NOT_A_DOCUMENT };
  } catch (error) {
    return {
      kind: "unreachable",
      why: (error /* a failed fetch or a body that is not JSON throws an Error */ as Error).message,
    };
  }
}

/** The dist-tag pointing at `version` when the answer lists it, `{}` when it lists it with no tag, null otherwise. */
export function listing(answer: RegistryAnswer, version: string): { tag?: string } | null {
  if (answer.kind !== "found" || !(version in answer.doc.versions)) return null;
  const tag = Object.entries(answer.doc["dist-tags"]).find(([, pointed]) => pointed === version)?.[0];
  return tag === undefined ? {} : { tag };
}

/** Where `poll` reads the clock and sleeps. */
export type PollIo = Pick<WaitIo, "now" | "sleep">;

/** Looks with `probe` until it answers, every `WAIT_POLL_MS`, for up to `WAIT_GIVE_UP_MS` after `started`; null on giving up. */
export async function poll<T>(io: PollIo, probe: () => Promise<T | null>, started: number): Promise<T | null> {
  const found = await probe();
  if (found !== null) return found;
  if (io.now() - started >= WAIT_GIVE_UP_MS) return null;
  await io.sleep(WAIT_POLL_MS);
  return poll(io, probe, started);
}

/** `repo release wait <name>@<version>`: polls npm every 10 seconds for up to 15 minutes. */
export async function releaseWait(argv: readonly string[], io: WaitIo): Promise<number> {
  const spec = argv[0] ?? "";
  const parts = argv.length === 1 ? splitSpec(spec) : null;
  if (parts === null) {
    io.stderr(`${WAIT_PREFIX}${WAIT_USAGE}\n`);
    return 1;
  }
  const probe = async () => listing(await registryDoc(io.fetch, parts.name), parts.version);
  const found = await poll(io, probe, io.now());
  if (found === null) {
    io.stderr(`${WAIT_PREFIX}${notOnNpm(spec, WAIT_GIVE_UP_MINUTES)}\n`);
    return 1;
  }
  io.stdout(`${published(parts.version, found.tag)}\n`);
  return 0;
}
