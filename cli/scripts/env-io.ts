/** The world every `bun repo env` verb reads and writes through, its real defaults, and the plumbing they share. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import crossSpawn from "cross-spawn";

import { KEY_EXTENSION, KEYS_DIR, KEYS_FILE } from "../env.constants.ts";
import { childEnv } from "../env.ts";
import { homeDir, readKeysFile, type KeysFile } from "../env/keys.ts";
import { EXIT_FAILED, EXIT_USAGE, PREFIX, TRAILING_NEWLINE, USAGE } from "./env-command.constants.ts";
import type { Captured } from "./lint.ts";
import { password } from "./prompt.ts";
import { toolEnv } from "./tool-env.ts";

/** A gh run: its arguments, its directory and its stdin. */
export type InputRunner = (args: string[], cwd: string, input: string) => Captured;

/** A child that shares this terminal, given its own env; resolves to its exit code. */
type Spawn = (command: string[], options: { cwd: string; env: Record<string, string> }) => Promise<number>;

/** Where an env verb runs, what it reads and prints, and the tools it starts; real ones by default. */
export type EnvDeps = {
  cwd?: string;
  /** HOME: the keys folder `~/.workerstack/keys` lives under it. */
  home?: string;
  /** The process variables read: WORKERSTACK_ENV_KEY, and the base of a `run` child's env. */
  env?: Record<string, string | undefined>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** The whole of a piped stdin. */
  stdin?: () => Promise<string>;
  /** Whether stdin is a terminal, read through `prompt` instead. */
  isTTY?: boolean;
  /** A hidden prompt. */
  prompt?: (message: string) => Promise<string>;
  gh?: InputRunner;
  spawn?: Spawn;
};

export type EnvIo = Required<EnvDeps>;

/** A prompt asking `ask` for a hidden answer to `message`. */
export function hiddenPrompt(
  ask: (options: { message: string }) => Promise<string>,
): (message: string) => Promise<string> {
  return (message) => ask({ message });
}

/** A runner of `bin` with stdin given; a tool that cannot start is a failed run with the reason as its stderr. */
export function inputRunner(bin: string): InputRunner {
  return (args, cwd, input) => {
    const result = spawnSync(bin, args, { cwd, encoding: "utf8", env: toolEnv(childEnv()), input });

    if (result.error !== undefined) return { code: EXIT_FAILED, stderr: result.error.message, stdout: "" };

    return { code: result.status ?? EXIT_FAILED, stderr: result.stderr, stdout: result.stdout };
  };
}

/** Runs `command` on this terminal with `env` as its whole env; a signal's end is exit 1. */
export function spawnInherit(
  command: string[],
  options: { cwd: string; env: Record<string, string> },
): Promise<number> {
  const [bin, ...args] = command;
  const result = crossSpawn.sync(String(bin), args, { ...options, stdio: "inherit" });

  if (result.error instanceof Error) throw new Error(`${PREFIX}could not run ${bin}: ${result.error.message}`);

  return Promise.resolve(result.status ?? EXIT_FAILED);
}

/** The whole of `stream` as text. */
export async function textOf(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of stream) chunks.push(chunk);

  return Buffer.concat(chunks).toString("utf8");
}

/** `deps` over the real world: this directory, HOME and env, the terminal, gh and cross-spawn. */
export function ioOf(deps: EnvDeps = {}): EnvIo {
  const env = childEnv();

  return {
    cwd: process.cwd(),
    env,
    gh: inputRunner("gh"),
    home: homeDir(env, os.homedir()),
    isTTY: process.stdin.isTTY,
    prompt: hiddenPrompt(password),
    spawn: spawnInherit,
    stderr: process.stderr.write.bind(process.stderr),
    stdin: textOf.bind(undefined, process.stdin),
    stdout: process.stdout.write.bind(process.stdout),
    ...deps,
  };
}

/** Prints the usage line; exit 4. */
export function usage(io: EnvIo): number {
  io.stderr(`${USAGE}\n`);

  return EXIT_USAGE;
}

/** Throws the one line a refusal prints. */
export function refuse(line: string): never {
  throw new Error(`${PREFIX}${line}`);
}

/** Runs `verb`; a throw prints its first line, prefixed `repo env: `, and exits 1. */
export async function guarded(io: EnvIo, verb: () => Promise<number>): Promise<number> {
  try {
    return await verb();
  } catch (error) {
    const line = String(error instanceof Error ? error.message : error)
      .split("\n", 1)
      .join("");

    io.stderr(`${line.startsWith(PREFIX) ? "" : PREFIX}${line}\n`);

    return EXIT_FAILED;
  }
}

/** A git run in `cwd`. */
function git(cwd: string, args: string[]): { status: number | null; stdout: string } {
  return spawnSync("git", args, { cwd, encoding: "utf8", env: toolEnv(childEnv()) });
}

/** The git toplevel of `cwd`; refuses a folder outside a git repo. */
export function repoRoot(cwd: string): string {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);

  if (result.status !== 0) refuse("not inside a git repo; run it in one");

  return path.resolve(result.stdout.trim());
}

/** The folder name of the main checkout of the repo at `root`: a worktree names the repo it belongs to. */
export function checkoutName(root: string): string {
  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout.trim();

  return path.basename(path.dirname(common));
}

/** `.repo/env.keys.json` at `root`; undefined when there is none. */
export function keysAt(root: string): KeysFile | undefined {
  return fs.existsSync(path.join(root, KEYS_FILE)) ? readKeysFile(root) : undefined;
}

/** `.repo/env.keys.json` at `root`; refuses, naming init, when there is none. */
export function keysOrRefuse(root: string): KeysFile {
  return keysAt(root) ?? refuse(`no ${KEYS_FILE}; run \`bun repo env init\``);
}

/** A key file's path, and how a line names it. */
export type KeyFile = { file: string; label: string };

/** The key file of `repo` under `home`, and how a line names it. */
export function keyFileOf(home: string, repo: string): KeyFile {
  const name = `${repo}${KEY_EXTENSION}`;

  return { file: path.join(home, KEYS_DIR, name), label: `~/${KEYS_DIR}/${name}` };
}

/** A path under `root` as a line names it: relative, with forward slashes. */
export function relTo(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join(path.posix.sep);
}

/** A value from the hidden prompt on a terminal, else the whole of stdin, its one trailing newline dropped. */
export async function readSecret(io: EnvIo, message: string): Promise<string> {
  if (io.isTTY) return io.prompt(message);
  const piped = await io.stdin();

  return piped.replace(TRAILING_NEWLINE, "");
}
