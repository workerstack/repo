import { z } from "zod";
import {
  ENCODED_SLASH,
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

const documentSchema = () =>
  z.object({ versions: z.record(z.string(), z.unknown()), "dist-tags": z.record(z.string(), z.string()) });

type Spec = { name: string; version: string };

/** `<name>@<version>` split at its last `@` (a scope's `@` leads the name); null when there is no version. */
function split(spec: string): Spec | null {
  const at = spec.lastIndexOf("@");
  return at > 0 && at < spec.length - 1 ? { name: spec.slice(0, at), version: spec.slice(at + 1) } : null;
}

/** The dist-tag pointing at `version` when the registry lists it, `{}` when it lists it with no tag, null when absent. */
async function lookup(
  fetcher: NonNullable<WaitIo["fetch"]>,
  name: string,
  version: string,
): Promise<{ tag?: string } | null> {
  try {
    const response = await fetcher(`${REGISTRY}${name.replace(SCOPE_SLASH, ENCODED_SLASH)}`);
    const parsed = documentSchema().safeParse(await response.json());
    if (!response.ok || !parsed.success || !(version in parsed.data.versions)) return null;
    const tag = Object.entries(parsed.data["dist-tags"]).find(([, pointed]) => pointed === version)?.[0];
    return tag === undefined ? {} : { tag };
  } catch {
    return null;
  }
}

/** Looks until the version is listed, every `WAIT_POLL_MS`, for up to `WAIT_GIVE_UP_MS` after `started`; null on giving up. */
async function poll(io: WaitIo, parts: Spec, started: number): Promise<{ tag?: string } | null> {
  const found = await lookup(io.fetch, parts.name, parts.version);
  if (found !== null) return found;
  if (io.now() - started >= WAIT_GIVE_UP_MS) return null;
  await io.sleep(WAIT_POLL_MS);
  return poll(io, parts, started);
}

/** `repo release wait <name>@<version>`: polls npm every 10 seconds for up to 15 minutes. */
export async function releaseWait(argv: readonly string[], io: WaitIo): Promise<number> {
  const spec = argv[0] ?? "";
  const parts = argv.length === 1 ? split(spec) : null;
  if (parts === null) {
    io.stderr(`${WAIT_PREFIX}${WAIT_USAGE}\n`);
    return 1;
  }
  const found = await poll(io, parts, io.now());
  if (found === null) {
    io.stderr(`${WAIT_PREFIX}${notOnNpm(spec, WAIT_GIVE_UP_MINUTES)}\n`);
    return 1;
  }
  io.stdout(`${published(parts.version, found.tag)}\n`);
  return 0;
}
