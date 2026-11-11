/** Repo set-ups and checks the worktree tests share. */
import path from "node:path";

import { expect } from "vitest";

import { commitIn, git, write, wt } from "./worktree-repo.ts";

const WORKTREE_LINE = /^worktree /gm;

/**
 * Worktrees m, fresh, dirty and un made through `add`; m, dirty and un each get a commit,
 * m and dirty are merged into the default branch, and dirty gets a loose file.
 */
export function mergedAndDirtyWorktrees(r: string, add: (name: string) => unknown): void {
  for (const n of ["m", "fresh", "dirty", "un"]) add(n);
  for (const n of ["m", "dirty", "un"]) commitIn(wt(r, n), `${n}.txt`);
  git(r, "merge", "-q", "--no-edit", "wt/m");
  git(r, "merge", "-q", "--no-edit", "wt/dirty");
  write(path.join(wt(r, "dirty"), "loose.txt"), "x");
}

/** Expect `git worktree list` to name the main checkout and nothing else. */
export function expectOnlyMainWorktree(r: string): void {
  const listed = git(r, "worktree", "list", "--porcelain");
  expect([...listed.matchAll(WORKTREE_LINE)]).toHaveLength(1);
}
