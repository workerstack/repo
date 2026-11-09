/** Temp consumer repos for the `repo turn` tests: committed, synced, with the standards pack. */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import { main } from "../turn.ts";
import type { Bins } from "../turn-steps.ts";

export const PKG_ROOT = path.resolve(import.meta.dirname, "../../..");
const BIN = path.join(PKG_ROOT, "bin/repo.ts");
const DEPENDENCIES = `${"node"}_modules`;
/** Each test spawns the real tools several times. */
export const SLOW = 120_000;

const temps: string[] = [];

/** Removes every repo made since the last call; each test file runs it after each test. */
export function cleanTemps(): void {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: root, encoding: "utf8" });
}

export function write(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

export const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

/** `count` one-line functions, each with a non-null assertion. */
export const nonNull = (count: number, stem = "a") =>
  Array.from(
    { length: count },
    (_, i) => `export const ${stem}${i === 0 ? "" : i} = (xs: string[]): string => xs.find(Boolean)!;\n`,
  ).join("");

/** A temp dir, removed by `cleanTemps`. */
export function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}

/**
 * A committed consumer with the standards pack, synced, and `files`. With `deps` its dependencies are this
 * checkout's, so typescript and vitest resolve from it; without, none are installed.
 */
export function consumer(files: Record<string, string>, { deps = true } = {}): string {
  const root = tempDir("workerstack-turn-");
  git(root, "init", "-q", "-b", "main");
  write(root, {
    "package.json": '{ "name": "app", "type": "module" }\n',
    "workerstack.config.ts": 'export default { packs: ["standards"] };\n',
    ...files,
  });
  if (deps) fs.symlinkSync(path.join(PKG_ROOT, DEPENDENCIES), path.join(root, DEPENDENCIES), "junction");
  const sync = spawnSync(process.execPath, [BIN, "sync"], { cwd: root, encoding: "utf8" });
  expect(sync.status, `${sync.stdout}${sync.stderr}`).toBe(0);
  git(root, "add", "-A");
  // Sync pointed core.hooksPath at the generated hooks; this commit is setup, not a turn under test.
  git(root, "commit", "-q", "--no-verify", "-m", "init");
  return root;
}

/** `repo turn` in `root` with its output collected; `bins` replaces tsc and vitest. */
export async function turn(root: string, argv: string[], bins?: Bins) {
  const out: string[] = [];
  const err: string[] = [];
  const io = { cwd: root, stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) };
  const code = await main(argv, bins === undefined ? io : { ...io, bins });
  return { code, out: out.join(""), err: err.join("") };
}

export const staged = (root: string) => git(root, "diff", "--cached", "--name-only").split("\n").filter(Boolean);
export const unstaged = (root: string) => git(root, "diff", "--name-only").split("\n").filter(Boolean);
