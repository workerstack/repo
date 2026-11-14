import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect } from "vitest";

import { childEnv } from "../../env.ts";
import { IGNORED_DIRS, REPO } from "../../repo-dirs.ts";
import type { DoctorResult } from "../doctor.types.ts";
import { addWorktree } from "../worktree-lifecycle.ts";
import { cleanLater, runDoctor, tmp, writeRequired } from "./doctor-kit.ts";
import { removeTree } from "../../remove-tree.ts";

/** The ignore lines for the ignored `.repo` dirs. */
export const REPO_IGNORES: string = IGNORED_DIRS.map((d) => `**/${REPO}/${d}/\n`).join("");

const IDENTITY = {
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_AUTHOR_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
};

export function git(cwd: string, ...args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8", env: childEnv(IDENTITY) });
}

export function put(root: string, rel: string, body = "x\n"): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

export function gitRepo(prefix: string, ignore: string): string {
  const r = fs.realpathSync(tmp(prefix));
  git(r, "init", "-q", "-b", "main");
  put(r, ".gitignore", ignore);
  git(r, "add", "-A");
  git(r, "commit", "-qm", "init");
  fs.mkdirSync(path.join(r, "packages", "a"), { recursive: true });
  return r;
}

export function commitIn(dir: string, name: string): void {
  put(dir, name);
  git(dir, "add", name);
  git(dir, "commit", "-qm", name);
}

export function doctor(cwd: string): DoctorResult {
  const bin = tmp("doc-ws-bin-");
  writeRequired(bin);
  return runDoctor({ cwd, pathEnv: bin, platform: "linux" });
}

/** The `workspace` row and the `- ` lines under it. */
export function section(stdout: string): { head: string; items: string[] } {
  const lines = stdout.split("\n");
  const at = lines.findIndex((l) => l.startsWith("workspace "));
  expect(at, stdout).toBeGreaterThan(-1);
  const items: string[] = [];
  for (let i = at + 1; i < lines.length && lines[i]!.startsWith("- "); i++) items.push(lines[i]!); // i < lines.length
  return { head: lines[at]!, items }; // at was asserted above
}

/** Every kind of leftover in repo `r`: stray ignored `.repo` dirs, nested ignores, an outside, a missing and a merged worktree. */
export function seedLeftovers(r: string) {
  const seeded = [
    put(r, "packages/b/.repo/tmp/x.txt"),
    put(r, "apps/x/.repo/plans/1-p.md"),
    put(r, "packages/b/.gitignore", ".tmp/\n"),
    put(r, "packages/u/.gitignore", ".tmp/\n"),
  ];
  git(r, "add", "packages/b/.gitignore");
  git(r, "commit", "-qm", "nested ignore");
  const outside = `${r}-outside`;
  cleanLater(outside);
  git(r, "worktree", "add", "-q", "-b", "spike", outside);
  const gone = addWorktree(r, "gone").path;
  removeTree(gone);
  const m = addWorktree(r, "m").path;
  commitIn(m, "m.txt");
  git(r, "merge", "-q", "wt/m");
  return { gone, m, outside, seeded };
}

function esc(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The patterns `seedLeftovers` lines must match, in order. */
export function leftoverPatterns(r: string, outside: string): string[] {
  const at = (...rel: string[]) => path.join(r, ...rel);
  const rule = `ignored by ${esc(at(".gitignore"))}:\\d+ \\.tmp/?`;
  return [
    `^${esc(`- stray .repo dir ${at("apps", "x", ".repo", "plans")} (holds plans): rm -r ${at("apps", "x", ".repo", "plans")}`)}$`,
    `^${esc(`- stray .repo dir ${at("packages", "b", ".repo", "tmp")}: rm -r ${at("packages", "b", ".repo", "tmp")}`)}$`,
    `^${esc(`- redundant .gitignore ${at("packages", "b", ".gitignore")} (".tmp/" `)}${rule}${esc(`): git -C ${r} rm -q packages/b/.gitignore`)}$`,
    `^${esc(`- redundant .gitignore ${at("packages", "u", ".gitignore")} (".tmp/" `)}${rule}${esc(`): rm ${at("packages", "u", ".gitignore")}`)}$`,
    `^${esc(`- duplicate .gitignore line ${at(".gitignore")}:2 ".tmp/" (".tmp" on line 1 covers it): delete line 2 of ${at(".gitignore")}`)}$`,
    `^${esc(`- missing worktree ${at(".worktrees", "gone")} (wt/gone): git -C ${r} worktree prune`)}$`,
    `^${esc(`- worktree outside .worktrees ${outside} (spike): git -C ${r} worktree remove ${outside}`)}$`,
    `^${esc(`- merged worktree ${at(".worktrees", "m")} (wt/m): bun repo worktree prune`)}$`,
  ];
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function commitAt(dir: string, name: string, when: string): void {
  put(dir, name);
  git(dir, "add", name);
  spawnSync("git", ["commit", "-qm", name], { cwd: dir, env: childEnv({ ...IDENTITY, GIT_COMMITTER_DATE: when }) });
}

/** Managed worktrees of every age: old (9 days), today, week (6), edge (7), dirty (12), landed (merged) and empty. */
export function seedStale(r: string): { old: string } {
  const old = addWorktree(r, "old").path;
  commitAt(old, "old.txt", daysAgo(9));
  commitAt(addWorktree(r, "today").path, "today.txt", daysAgo(0));
  commitAt(addWorktree(r, "week").path, "week.txt", daysAgo(6));
  const edge = addWorktree(r, "edge").path;
  commitAt(edge, "edge.txt", daysAgo(7));
  const dirty = addWorktree(r, "dirty").path;
  commitAt(dirty, "dirty.txt", daysAgo(12));
  put(dirty, "wip.txt");
  commitAt(addWorktree(r, "landed").path, "landed.txt", daysAgo(20));
  git(r, "merge", "-q", "wt/landed");
  addWorktree(r, "empty");
  return { old };
}
