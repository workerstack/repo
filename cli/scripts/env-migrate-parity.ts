/**
 * The value parity of `bun repo env migrate`: a child `bun` process imports each target's file by file URL and prints,
 * on one line behind a fixed sentinel, the sha256 of every value of the global and scope views of the env the target
 * names. Each read is a fresh child, so no module cache serves an old file to a new read. The child is handed file URLs
 * and export names on stdin and prints hashes only: a load or read that throws prints the index of its target and the
 * class name of what it threw, never its message, and the child's stderr is not read. A child that prints no sentinel
 * line, or one that does not parse, fails on a fixed line; one still running after a minute is killed.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { bunRuntime } from "../env/keys.ts";
import { MS_PER_SECOND, PARITY_SENTINEL, PARITY_TIMEOUT_MS, SCOPES } from "./env-command.constants.ts";

/** One env to hash: the file that exports it, repo-relative, and the export's name. */
export type ParityTarget = { readonly rel: string; readonly name: string };

/** One env's sha256 per key, by view. */
export type ViewHashes = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Every target's hashes, in order; or the file the check failed at and a line that holds no value. */
export type Parity =
  | { readonly ok: true; readonly hashes: readonly ViewHashes[] }
  | { readonly ok: false; readonly rel: string; readonly reason: string };

/** How the child runs: its whole env, and how long it may take. */
export type ParityRun = { readonly env: NodeJS.ProcessEnv; readonly timeout?: number };

/** What the child prints behind the sentinel: the hashes, or the index of the target that threw and its class. */
type ChildOut = { readonly hashes?: ViewHashes[]; readonly failed?: number; readonly error?: string };

/** What the child printed, and whether it was killed for its time. */
type ChildRun = { readonly stdout: string; readonly isLate: boolean };

/** The child's script, run by `bun -e`. */
function childScript(): string {
  return [
    'const { createHash } = await import("node:crypto");',
    "const targets = JSON.parse(await Bun.stdin.text());",
    `const views = ${JSON.stringify(SCOPES)};`,
    'const hash = (value) => createHash("sha256").update(String(value)).digest("hex");',
    "const viewHashes = (view) => Object.fromEntries(Object.keys(view).map((key) => [key, hash(view[key])]));",
    "const hashes = [];",
    "let out = { hashes };",
    "for (const [index, target] of targets.entries()) {",
    "  try {",
    "    const env = (await import(target.url))[target.name];",
    "    hashes.push(Object.fromEntries(views.map((view) => [view, viewHashes(env[view])])));",
    "  } catch (error) {",
    '    const name = typeof error === "object" && error !== null ? error.constructor?.name : typeof error;',
    "    out = { error: String(name), failed: index };",
    "    break;",
    "  }",
    "}",
    `process.stdout.write("\\n" + ${JSON.stringify(PARITY_SENTINEL)} + JSON.stringify(out) + "\\n");`,
  ].join("\n");
}

/** What the sentinel line holds; undefined when it does not parse, so no parse error echoes its text. */
function readOut(line: string): ChildOut | undefined {
  try {
    return JSON.parse(line.slice(PARITY_SENTINEL.length)) /* the child prints a ChildOut */ as ChildOut;
  } catch {
    return undefined;
  }
}

/** A failed check of `targets`, at every file it reads, for `reason`. */
function failed(targets: readonly ParityTarget[], reason: string): Parity {
  return { ok: false, reason, rel: [...new Set(targets.map(({ rel }) => rel))].join(", ") };
}

/** Runs the child on `input`, killing it once it takes over `timeout` ms. */
async function runChild(root: string, input: string, { env, timeout }: Required<ParityRun>): Promise<ChildRun> {
  const child = spawn(bunRuntime(process.versions, process.execPath), ["-e", childScript()], {
    cwd: root,
    env,
    stdio: ["pipe", "pipe", "ignore"],
  });

  const chunks: Buffer[] = [];
  let isLate = false;

  const timer = setTimeout(() => {
    isLate = true;
    child.kill();
  }, timeout);

  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stdin.end(input);
  await once(child, "close");
  clearTimeout(timer);

  return { isLate, stdout: Buffer.concat(chunks).toString("utf8") };
}

/** The hashes of `targets` under `root`, read by a fresh child; see the file comment. */
export async function hashEnvs(root: string, targets: readonly ParityTarget[], run: ParityRun): Promise<Parity> {
  const input = JSON.stringify(
    targets.map(({ name, rel }) => ({ name, url: pathToFileURL(path.join(root, rel)).href })),
  );

  const timeout = run.timeout ?? PARITY_TIMEOUT_MS;
  const { isLate, stdout } = await runChild(root, input, { env: run.env, timeout });
  const line = stdout.split("\n").findLast((each) => each.startsWith(PARITY_SENTINEL));
  const slow = `the check took over ${timeout / MS_PER_SECOND}s`;

  if (line === undefined) return failed(targets, isLate ? slow : "the check printed no result");
  const out = readOut(line);

  if (out === undefined) return failed(targets, "the check printed a result that does not parse");

  if (out.hashes !== undefined) return { hashes: out.hashes, ok: true };

  return { ok: false, reason: String(out.error), rel: String(targets[Number(out.failed)]?.rel) };
}
