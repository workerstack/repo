/** Planted temp git repos and an in-process `main` runner for the worktree tests; nothing here touches this repo's own git state. */
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { bunPath } from "../../../dev/test-paths";
import { childEnv } from "../../env.ts";
import { removeOrExplain } from "../../fixtures/remove-or-explain.ts";
import type { HookIo } from "../hook-io.ts";
import { sharedGitReason } from "../worktree-guards.ts";
import type { ShellAt } from "../worktree.types.ts";
import { main } from "../worktree.ts";

const REPO_BIN = path.join(import.meta.dirname, "../../../bin/repo.ts");

/** `bun repo worktree <args>` in `cwd` with the harness project-dir vars removed, so the root comes from `cwd` unless a case sets one. */
export function cli(
  cwd: string,
  args: string[],
  { env = {}, input }: { env?: Record<string, string>; input?: string } = {},
): SpawnSyncReturns<string> {
  const e = childEnv({ GROK_WORKSPACE_ROOT: undefined, CLAUDE_PROJECT_DIR: undefined });
  // win32 env names ignore case, so an override of PATH must drop the inherited Path.
  for (const k of Object.keys(e)) if (Object.keys(env).some((o) => o.toLowerCase() === k.toLowerCase())) delete e[k];
  return spawnSync(bunPath(), [REPO_BIN, "worktree", ...args], { cwd, env: { ...e, ...env }, input, encoding: "utf8" });
}

/** A postinstall that leaves `installed.marker` in the dir it ran in. */
export const MARK = `node -e "require('fs').writeFileSync('installed.marker','1')"`;
export const marker = (dir: string): boolean => fs.existsSync(path.join(dir, "installed.marker"));

/** Gives repo `r` a package.json with a `postinstall` and a local `file:` dependency, with a real bun.lock made by one offline `bun install`. */
export function bunRepo(r: string, postinstall: string): string {
  const pkg = (scripts: object) =>
    `${JSON.stringify({ name: "fixture", version: "1.0.0", scripts, dependencies: { dep: "file:./vendor/dep" } }, null, 2)}\n`;
  write(path.join(r, ".gitignore"), ".env\n.worktrees/\nnode_modules/\n");
  write(path.join(r, "vendor/dep/package.json"), `${JSON.stringify({ name: "dep", version: "1.0.0" })}\n`);
  write(path.join(r, "package.json"), pkg({}));
  execFileSync("bun", ["install"], { cwd: r, stdio: "ignore" });
  write(path.join(r, "package.json"), pkg({ postinstall }));
  git(r, "add", "-A");
  git(r, "commit", "-qm", "bun");
  return r;
}

/** Points origin/HEAD at a copy of main. */
export function pinOriginHead(r: string): void {
  git(r, "update-ref", "refs/remotes/origin/main", "main");
  git(r, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
}

/** A post-rewrite hook that commits to the default branch in the root, once or on every rebase. */
export function raceHook(r: string, once: boolean): void {
  const mark = shPath(path.join(r, ".git", "raced"));
  plantHook(r, "post-rewrite", [
    ...(once ? [`[ -e '${mark}' ] && exit 0`, `: > '${mark}'`] : []),
    `git -c user.email=t@t -c user.name=t -C '${shPath(r)}' commit -q --allow-empty -m raced`,
  ]);
}

export const short = (r: string, ref: string): string => git(r, "rev-parse", "--short", ref);
export const subjects = (r: string, ref: string = "main"): string[] => git(r, "log", "--format=%s", ref).split("\n");

/** Where a guarded shell line runs: root `root`, checkout `checkout`, shell cwd `cwd`. */
export function at(root: string, checkout: string = root, cwd: string = checkout): ShellAt {
  return { roots: { root, checkout, cwd: checkout }, cwd };
}

export const NONE: ReadonlySet<string> = new Set();

/** `sharedGitReason` for a line run at `place` with grant words `asked`. */
export function shared(command: string, place: ShellAt, asked: ReadonlySet<string> = NONE): string | null {
  return sharedGitReason(command, { ...place, asked });
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();
}

export function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function commitIn(dir: string, file: string, text: string = file): void {
  write(path.join(dir, file), text);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", file);
}

/** `<root>/.worktrees/<name>`. */
export const wt = (root: string, name: string): string => path.join(root, ".worktrees", name);

export const hasBranch = (root: string, branch: string): boolean => {
  try {
    git(root, "show-ref", "--verify", "-q", `refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
};

/** The path as a shell script spells it: forward slashes. */
export const shPath = (p: string): string => p.split(path.sep).join("/");

/** A shell hook script in the repo's hooks dir that git runs without the caller's repo variables. */
export function plantHook(root: string, name: string, lines: string[]): void {
  const hook = path.join(root, ".git", "hooks", name);
  write(hook, ["#!/bin/sh", "unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX", ...lines, ""].join("\n"));
  fs.chmodSync(hook, 0o755);
}

export interface Scratch {
  /** An empty temp dir, removed by `cleanup`. */
  dir(prefix: string): string;
  /** A repo on `main` with one commit, a gitignored `.worktrees/` and a committer identity. */
  repo(): string;
  /** Removes every dir made and restores the working directory and the env. */
  cleanup(): void;
}

export function scratch(): Scratch {
  const dirs: string[] = [];
  const home = process.cwd();
  const dir = (prefix: string) => {
    const made = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    dirs.push(made);
    return made;
  };
  const repo = () => {
    const r = dir("wt-");
    git(r, "init", "-q", "-b", "main");
    git(r, "config", "user.email", "t@t");
    git(r, "config", "user.name", "t");
    git(r, "config", "core.autocrlf", "false");
    write(path.join(r, ".gitignore"), ".env\n.worktrees/\n");
    write(path.join(r, "packages/a/index.js"), "");
    git(r, "add", "-A");
    git(r, "commit", "-qm", "init");
    return r;
  };
  const cleanup = () => {
    process.chdir(home);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) {
      for (const x of [d, `${d}-alias`, `${d}-outside`]) {
        removeOrExplain(x);
      }
    }
  };
  return { dir, repo, cleanup };
}

/** A stdin that yields `text` in one chunk, then EOF. */
export function stdinOf(text: string): HookIo {
  const chunks = text ? [Buffer.from(text)] : [];
  return { readChunk: () => chunks.shift() ?? null, write: () => undefined };
}

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `fn` with stdout and stderr collected instead of printed. */
export function captured<T>(fn: () => T): { value: T; stdout: string; stderr: string } {
  const out: string[] = [];
  const err: string[] = [];
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true)),
    vi.spyOn(process.stderr, "write").mockImplementation((s) => (err.push(String(s)), true)),
  ];
  try {
    return { value: fn(), stdout: out.join(""), stderr: err.join("") };
  } finally {
    for (const s of spies) s.mockRestore();
  }
}

/** `main(args)` in `cwd` with the harness project-dir vars removed, so the root comes from `cwd`. */
export function mainIn(cwd: string, args: string[], stdin: string = ""): Run {
  for (const k of ["GROK_WORKSPACE_ROOT", "CLAUDE_PROJECT_DIR"]) vi.stubEnv(k, undefined);
  process.chdir(cwd);
  const { value, stdout, stderr } = captured(() => main(args, stdinOf(stdin)));
  return { code: value, stdout, stderr };
}
