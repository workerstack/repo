import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, vi } from "vitest";
import { cleanBuilds } from "../clean-builds.ts";
import { runClean } from "../clean-run.ts";
import { childEnv } from "../../env.ts";
import { IGNORED_DIRS, REPO } from "../../repo-dirs.ts";
import { removeTemps } from "../../__fixtures__/remove-temps.ts";

/** The clock every clean test plans against, and its units. */
export const NOW: number = Date.parse("2026-11-03T12:00:00Z");
export const HOUR = 3600_000;
export const DAY: number = 24 * HOUR;
/** A live and a dead session id. */
export const LIVE = "11111111-aaaa-4bbb-8ccc-000000000001";
export const DEAD = "22222222-aaaa-4bbb-8ccc-000000000002";
const R = REPO;
const T = `${REPO}/scratch`;
const S = `${REPO}/tmp`;

/** The ignore lines a checkout carries for the ignored `.repo` dirs. */
export const IGNORE_LINES: string = IGNORED_DIRS.map((d) => `**/${REPO}/${d}/\n`).join("");

/** A temp dir maker whose dirs, and every mock, go after each case. */
export function cleanDirs(): (prefix: string) => string {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    removeTemps(dirs.splice(0));
  });
  return (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
}

/** Sets the mtime of a path and everything under it, without following links. */
export function age(p: string, ms: number): void {
  const st = fs.lstatSync(p);
  if (st.isDirectory()) for (const name of fs.readdirSync(p)) age(path.join(p, name), ms);
  if (!st.isSymbolicLink()) fs.utimesSync(p, new Date(NOW - ms), new Date(NOW - ms));
}

/** A writer under `root`: `rel` gets `body`, last touched `ms` before NOW. */
export function planter(root: string): (rel: string, ms: number, body?: string) => string {
  return (rel, ms, body = "x") => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    age(file, ms);
    return file;
  };
}

/** `git init` in `root` with the ignored `.repo` dirs ignored. */
export function gitInit(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root, env: childEnv({ GIT_DIR: undefined, GIT_INDEX_FILE: undefined }) });
  fs.writeFileSync(path.join(root, ".gitignore"), IGNORE_LINES);
}

/** A repo whose ignored `.repo` dirs hold one entry of every kind the sweep plans. */
export function sweepRepo(tempDir: (prefix: string) => string): string {
  const root = tempDir("repo-clean-");
  gitInit(root);
  const put = planter(root);
  for (const file of ["plans/1-a", "roadmaps/1-r", "handoffs/1-h", "implementations/1-i"])
    put(`${R}/${file}-20261103T000000Z.md`, 48 * HOUR);
  put(`${T}/3-notes-20261103T120000Z.md`, 48 * HOUR);
  put(`${T}/old.log`, 2 * HOUR);
  put(`${T}/new.log`, 5 * 60_000);
  put(`${T}/review/notes.md`, 2 * HOUR);
  age(path.join(root, T, "review"), 2 * HOUR);
  for (const sid of [LIVE, DEAD]) put(`${S}/sessions/${sid}/wrote.txt`, 2 * HOUR);
  for (const end of [LIVE, DEAD, "default"]) put(`${S}/orchestrator-logs/ask-stop-${end}`, 2 * HOUR);
  put(`${S}/stash/old.txt`, 48 * HOUR);
  put(`${S}/stash/new.txt`, HOUR);
  put(`${S}/browser/session.json`, 48 * HOUR);
  put(`${S}/evals/cache/old.json`, 48 * HOUR);
  // Adding a file bumps its dir's mtime; the session dirs were last touched with their files.
  for (const sid of [LIVE, DEAD]) age(path.join(root, S, "sessions", sid), 2 * HOUR);
  for (const dir of ["evals/cache", "evals"]) age(path.join(root, S, dir), 48 * HOUR);
  return root;
}

/** One sweep of `root` at NOW with LIVE live; its exit code and report lines. */
export function clean(root: string, dryRun = false): { code: number; lines: string[] } {
  const lines: string[] = [];
  const code = runClean({ root, now: NOW, liveSessions: new Set([LIVE]), dryRun, out: (l: string) => lines.push(l) });
  return { code, lines };
}

/** Whether a root-relative path exists under `root`. */
export const exists =
  (root: string) =>
  (p: string): boolean =>
    fs.existsSync(path.join(root, p));

const BUILD_FILES: Record<string, string> = {
  ".gitignore": `.next\n.turbo/\n.flare\nnode_modules\n*.tsbuildinfo\n${IGNORE_LINES}`,
  "src/a.ts": "x",
  ".next/a": "abc",
  "apps/.turbo/b": "de",
  "x.tsbuildinfo": "f",
  "node_modules/m/i": "ghij",
  ".flare/s": "k",
  ".repo/scratch/old.log": "l",
};

/** A git repo with a real .gitignore, caches and node_modules under it, and a scratch dir. */
export function buildRepo(tempDir: (prefix: string) => string): string {
  const root = fs.realpathSync(tempDir("repo-clean-build-"));
  execFileSync("git", ["init", "-q"], { cwd: root, env: childEnv({ GIT_DIR: undefined, GIT_INDEX_FILE: undefined }) });
  const put = planter(root);
  for (const [name, text] of Object.entries(BUILD_FILES)) put(name, 0, text);
  return root;
}

/** How one build clean runs. */
export type BuildOptions = { deps?: boolean; dryRun?: boolean; names?: string[]; rm?: typeof fs.rmSync };

/** One `repo clean --build` (or `--deps`) of `root`; its exit code and report lines. */
export function build(
  root: string,
  { deps = false, dryRun = false, names = [], rm }: BuildOptions = {},
): { code: number; lines: string[] } {
  const lines: string[] = [];
  const code = cleanBuilds({ root, deps, dryRun, names, out: (l) => lines.push(l), rm });
  return { code, lines };
}
