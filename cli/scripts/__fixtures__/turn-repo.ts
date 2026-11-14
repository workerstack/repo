/** Temp consumer repos for the `repo turn` tests: committed, synced, with the standards pack. */
import type { Captured } from "../lint.ts";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import { main as precommitMain } from "../precommit.ts";
import { main } from "../turn.ts";
import { dirName, type Bins } from "../turn-steps.ts";
import { fwd } from "../../../dev/test-paths.ts";
import { WRITABLE_MODE } from "../../sync/write.constants.ts";
import { removeTemps } from "../../__fixtures__/remove-temps.ts";

export const PKG_ROOT = path.resolve(import.meta.dirname, "../../..");
const BIN = path.join(PKG_ROOT, "bin/repo.ts");
const DEPENDENCIES = `${"node"}_modules`;
/** Each test spawns the real tools several times. */
export const SLOW = 120_000;

const temps: string[] = [];

/** Removes every repo made since the last call; each test file runs it after each test. */
export function cleanTemps(): void {
  removeTemps(temps.splice(0));
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: root, encoding: "utf8" });
}

/** Writes each file, first making one sync left read-only writable, as a hand edit has to. */
export function write(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() === true) fs.chmodSync(file, WRITABLE_MODE);
    fs.writeFileSync(file, text);
  }
}

export const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

/** `count` functions, each with a non-null assertion. */
export const nonNull = (count: number, stem = "a") =>
  Array.from(
    { length: count },
    (_, i) => `export function ${stem}${i === 0 ? "" : i}(xs: string[]): string {\n  return xs.find(Boolean)!;\n}\n`,
  ).join("\n");

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
    "repo.config.ts": 'export default { packs: ["standards"] };\n',
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

/** `run` in `root` with its output collected; `bins` replaces tsc and vitest. */
async function collected(run: typeof main, root: string, argv: string[], bins?: Bins) {
  const out: string[] = [];
  const err: string[] = [];
  const io = { cwd: root, stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) };
  const code = await run(argv, bins === undefined ? io : { ...io, bins });
  return { code, out: out.join(""), err: err.join("") };
}

/** `repo turn` in `root` with its output collected; `bins` replaces tsc and vitest. */
export const turn = (root: string, argv: string[], bins?: Bins) => collected(main, root, argv, bins);

/** `repo precommit` in `root` with its output collected; `bins` replaces tsc and vitest. */
export const precommit = (root: string, bins?: Bins, argv: string[] = []) => collected(precommitMain, root, argv, bins);

/** Fake tsc and vitest that pass, recording each call in `calls` as `{bin} {dir} {args}`, the dir relative to `root`. */
export function recording(root: string) {
  const calls: string[] = [];

  function called(bin: string, args: string[], cwd: string) {
    return calls.push(`${bin} ${dirName(fwd(path.relative(root, cwd)))} ${args.join(" ")}`);
  }

  const bins: Bins = {
    tsc: async (args, cwd) => (called("tsc", args, cwd), { code: 0, stderr: "", stdout: "" }),
    vitest: (args, cwd) => (called("vitest", args, cwd), null),
  };

  return { bins, calls };
}

/** The store file ci and turn keep for the tsconfig at root-relative `config`. */
export function tsbuildinfo(config: string): string {
  return `.repo/tmp/tsbuildinfo/${config.replaceAll("/", "-")}.tsbuildinfo`;
}

/** The call `recording` holds for turn's incremental typecheck of `config` in the root. */
export function tscCall(config: string): string {
  return `tsc . --noEmit --incremental --tsBuildInfoFile ${tsbuildinfo(config)} -p ${config}`;
}

export const staged = (root: string) => git(root, "diff", "--cached", "--name-only").split("\n").filter(Boolean);
export const unstaged = (root: string) => git(root, "diff", "--name-only").split("\n").filter(Boolean);

/** A tsconfig.json on this checkout's bun base over `src`. */

export const TSCONFIG = `{\n  "extends": ${JSON.stringify(path.join(PKG_ROOT, "tsconfig/bun.json"))},\n  "include": ["src"]\n}\n`;
/**
 * A folder's tsconfig.src.json, and the strict.json it extends that points at this checkout's strict base, so the
 * src config's text, which bun fmt keeps as is, does not depend on how long the checkout's path is.
 */
export const srcConfig = (dir = ""): Record<string, string> => ({
  [path.posix.join(dir, "strict.json")]:
    `{\n  "extends": ${JSON.stringify(path.join(PKG_ROOT, "tsconfig/strict.json"))}\n}\n`,
  [path.posix.join(dir, "tsconfig.src.json")]:
    '{\n  "exclude": ["**/*.test.ts"],\n  "extends": ["./tsconfig.json", "./strict.json"]\n}\n',
});

/** A tool run that passed with no output. */
export const OK: Captured = { code: 0, stderr: "", stdout: "" };

/** Bins whose tsc passes with no output and that have no vitest. */
export const TSC_PASSES: Bins = { tsc: () => Promise.resolve(OK), vitest: () => null };

/** The `packageManager` pin of the running bun. */
export const PIN = `bun@${Bun.version}`;

/** A private app's manifest fields. */
export const APP = { main: "src/a.ts", name: "app", packageManager: PIN, private: true, sideEffects: false, type: "module" };

/** `APP` as its package.json text. */
export const APP_MANIFEST = `${JSON.stringify(APP)}\n`;

/** A source file with one export. */
export const ANSWER = "export const answer = 42;\n";

/** A passing test of `ANSWER`. */
export const ANSWER_TEST =
  'import { expect, it } from "vitest";\nimport { answer } from "./answer.ts";\n\n' +
  'it("answers", () => {\n  expect(answer).toBe(42);\n});\n';
