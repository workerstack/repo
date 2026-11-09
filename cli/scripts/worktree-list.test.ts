import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { commitIn, git, hasBranch, scratch, write, wt } from "./fixtures/worktree-repo.ts";
import { addWorktree, defaultBranch, hasOwnCommits, isMerged, listWorktrees, pruneWorktrees } from "./worktree.ts";

const tmp = scratch();
afterEach(() => tmp.cleanup());

/** A worktree outside .worktrees on branch `spike`. */
function outsideOf(r: string): string {
  const outside = `${r}-outside`;
  git(r, "worktree", "add", "-q", outside, "-b", "spike");
  return outside;
}

it("lists each linked worktree with its state, merge status and whether it is managed", () => {
  const r = tmp.repo();
  addWorktree(r, "auth");
  addWorktree(r, "gone");
  addWorktree(r, "done");
  commitIn(wt(r, "done"), "done.txt");
  git(r, "merge", "-q", "--no-edit", "wt/done");
  fs.rmSync(wt(r, "gone"), { recursive: true });
  const outside = outsideOf(r);
  write(path.join(outside, "scratch.txt"), "x");
  git(outside, "switch", "-q", "--detach");
  const rows = listWorktrees(r).map((w) => [w.path, w.branch, w.state, w.merged, w.managed]);
  const byPath = (a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0]));
  expect(rows.sort(byPath)).toEqual(
    [
      [wt(r, "auth"), "wt/auth", "clean", false, true],
      [wt(r, "done"), "wt/done", "clean", true, true],
      [wt(r, "gone"), "wt/gone", "missing", false, true],
      [outside, null, "dirty", false, false],
    ].sort(byPath),
  );
});

it("lists nothing outside a git repo", () => {
  expect(listWorktrees(tmp.dir("wt-none-"))).toEqual([]);
});

it("names origin/HEAD's branch first, then init.defaultBranch, main, master, and the checked-out branch last", () => {
  const r = tmp.repo();
  git(r, "branch", "trunk");
  git(r, "update-ref", "refs/remotes/origin/trunk", "trunk");
  git(r, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
  expect(defaultBranch(r)).toBe("trunk");
  git(r, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
  git(r, "config", "init.defaultBranch", "trunk");
  expect(defaultBranch(r)).toBe("trunk");
  git(r, "config", "--unset", "init.defaultBranch");
  git(r, "switch", "-q", "trunk");
  expect(defaultBranch(r)).toBe("main");
  git(r, "branch", "-m", "main", "master");
  expect(defaultBranch(r)).toBe("master");
  git(r, "branch", "-m", "master", "develop");
  expect(defaultBranch(r)).toBe("trunk");
  git(r, "switch", "-q", "--detach");
  git(r, "branch", "-D", "trunk");
  expect(defaultBranch(r)).toBe("HEAD");
});

it("tells a branch the default holds, and a fresh branch from one that moved", () => {
  const r = tmp.repo();
  addWorktree(r, "fresh");
  addWorktree(r, "moved");
  commitIn(wt(r, "moved"), "m.txt");
  expect(hasOwnCommits(r, "wt/fresh")).toBe(false);
  expect(hasOwnCommits(r, "wt/moved")).toBe(true);
  expect(hasOwnCommits(r, "wt/nope")).toBe(false);
  expect(isMerged(r, "wt/fresh")).toBe(true);
  expect(isMerged(r, "wt/moved")).toBe(false);
  git(r, "merge", "-q", "--no-edit", "wt/moved");
  expect(isMerged(r, "wt/moved")).toBe(true);
});

it("removes only clean managed worktrees whose own commits reached the default branch, and merged wt/* branches without one", () => {
  const r = tmp.repo();
  for (const n of ["m", "fresh", "dirty", "un"]) addWorktree(r, n);
  for (const n of ["m", "dirty", "un"]) commitIn(wt(r, n), `${n}.txt`);
  git(r, "merge", "-q", "--no-edit", "wt/m");
  git(r, "merge", "-q", "--no-edit", "wt/dirty");
  write(path.join(wt(r, "dirty"), "loose.txt"), "x");
  outsideOf(r);
  git(r, "branch", "wt/o", "main");
  expect(pruneWorktrees(r)).toEqual([
    { path: wt(r, "m"), branch: "wt/m" },
    { path: null, branch: "wt/o" },
  ]);
  expect(fs.existsSync(wt(r, "m"))).toBe(false);
  expect([hasBranch(r, "wt/m"), hasBranch(r, "wt/o")]).toEqual([false, false]);
  for (const n of ["fresh", "dirty", "un"]) expect(fs.existsSync(wt(r, n)), n).toBe(true);
  expect(pruneWorktrees(r)).toEqual([]);
});

it("keeps a merged worktree git will not remove, and a merged branch git will not delete", () => {
  const r = tmp.repo();
  addWorktree(r, "locked");
  commitIn(wt(r, "locked"), "l.txt");
  git(r, "merge", "-q", "--no-edit", "wt/locked");
  git(r, "worktree", "lock", wt(r, "locked"));
  git(r, "branch", "wt/stuck", "main");
  write(path.join(r, ".git/refs/heads/wt/stuck.lock"), "");
  expect(pruneWorktrees(r)).toEqual([]);
  expect(fs.existsSync(wt(r, "locked"))).toBe(true);
  expect(hasBranch(r, "wt/stuck")).toBe(true);
});
