/** Planted temp git repos and an in-process `main` runner for the worktree tests; nothing here touches this repo's own git state. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { removeOrExplain } from "../../fixtures/remove-or-explain.ts";
import type { HookIo } from "../hook-io.ts";
import { main } from "../worktree.ts";

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
