import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { commitIn, git, hasBranch, plantHook, scratch, shPath, write, wt } from "./fixtures/worktree-repo.ts";
import { addWorktree, finishWorktree } from "./worktree-lifecycle.ts";

const tmp = scratch();
afterEach(() => tmp.cleanup());

/** A repo with worktree `name` holding one commit of its own. */
function withCommit(name = "c", file = `${name}.txt`, text = file): string {
  const r = tmp.repo();
  addWorktree(r, name);
  commitIn(wt(r, name), file, text);
  return r;
}

/** `git rebase main` in `dir`, which stops on a conflict. */
function rebaseIntoConflict(dir: string): void {
  expect(() => git(dir, "rebase", "main")).toThrow();
}

it("names the list command for a worktree and branch that do not exist", () => {
  expect(() => finishWorktree(tmp.repo(), "nosuch")).toThrow(
    "no worktree or branch named nosuch: bun repo worktree list shows them",
  );
});

it("asks for a name when none is given outside a worktree", () => {
  const r = withCommit();
  expect(() => finishWorktree(r, undefined)).toThrow("run finish inside .worktrees/<name> or pass its name");
  expect(fs.existsSync(wt(r, "c"))).toBe(true);
});

it("aborts a conflicting rebase, names the file and keeps the worktree untouched", () => {
  const f = "packages/a/index.js";
  const r = withCommit("c", f, "wt\n");
  commitIn(r, f, "main\n");
  const before = git(r, "rev-parse", "main");
  const w = wt(r, "c");
  const message = `rebasing wt/c onto main conflicts in ${f}: run git -C ${w} rebase main, fix each file, git -C ${w} add <file>, git -C ${w} rebase --continue, rerun the checks, then run finish again`;
  expect(() => finishWorktree(r, "c")).toThrow(message);
  expect(git(r, "rev-parse", "main")).toBe(before);
  expect([git(w, "branch", "--show-current"), git(w, "status", "--porcelain")]).toStrictEqual(["wt/c", ""]);
  expect(() => finishWorktree(r, "c")).toThrow(message);
});

it("refuses a worktree that is mid-rebase", () => {
  const f = "packages/a/index.js";
  const r = withCommit("c", f, "wt\n");
  commitIn(r, f, "main\n");
  rebaseIntoConflict(wt(r, "c"));
  expect(() => finishWorktree(r, "c")).toThrow(
    `${wt(r, "c")} is mid-rebase: finish it with git -C ${wt(r, "c")} rebase --continue (or --abort), then run finish again`,
  );
});

it("refuses uncommitted changes, untracked files included, with a count that agrees in number", () => {
  const r = withCommit("d");
  const w = wt(r, "d");
  const before = git(r, "rev-parse", "main");
  write(path.join(w, "packages/a/index.js"), "edited\n");
  write(path.join(w, "loose.txt"), "x");
  expect(() => finishWorktree(r, "d")).toThrow(`${w} has uncommitted changes in 2 files: commit or drop them`);
  git(w, "checkout", "-q", "--", "packages/a/index.js");
  expect(() => finishWorktree(r, "d")).toThrow(`${w} has uncommitted changes in 1 file: commit or drop them`);
  expect(git(r, "rev-parse", "main")).toBe(before);
  expect(hasBranch(r, "wt/d")).toBe(true);
});

it("refuses a worktree that has another branch or a detached HEAD checked out", () => {
  const r = withCommit("e");
  const w = wt(r, "e");
  git(w, "switch", "-q", "-c", "elsewhere");
  expect(() => finishWorktree(r, "e")).toThrow(
    `${w} has elsewhere checked out, not wt/e: run git -C ${w} switch wt/e, then run finish again`,
  );
  git(w, "switch", "-q", "--detach");
  expect(() => finishWorktree(r, "e")).toThrow(`${w} has a detached HEAD checked out, not wt/e`);
});

it("refuses a root with no branch checked out and no origin/HEAD", () => {
  const r = withCommit("h");
  git(r, "switch", "-q", "--detach");
  git(r, "branch", "-m", "main", "dev");
  expect(() => finishWorktree(r, "h")).toThrow(
    `${r} has no branch checked out and no origin/HEAD; check out the default branch there`,
  );
});

it("sends a branch with commits and no worktree back to add", () => {
  const r = withCommit("f");
  git(r, "worktree", "remove", wt(r, "f"));
  expect(() => finishWorktree(r, "f")).toThrow(
    "wt/f has commits that main lacks and no worktree: run bun repo worktree add f to bring it back, then run finish again",
  );
  fs.mkdirSync(wt(r, "ghost"), { recursive: true });
  expect(() => finishWorktree(r, "ghost")).toThrow("no worktree or branch named ghost");
});

it("reports when the branch cannot be compared with the default branch", () => {
  const r = withCommit("u");
  git(r, "update-ref", "-d", "refs/heads/main");
  expect(() => finishWorktree(r, "u")).toThrow(
    /^could not compare wt\/u with main: fatal: ambiguous argument 'main\.\.wt\/u'/,
  );
});

it("reports git's reason when a rebase fails without a conflict", () => {
  const r = withCommit("x");
  write(path.join(wt(r, "x"), ".git"), "gitdir: /nonexistent/gitdir\n");
  expect(() => finishWorktree(r, "x")).toThrow(
    /^rebasing wt\/x onto main failed: fatal: gitfile does not point to a valid repository/,
  );
});

it("reports git's reason, on one line, when the main checkout's own changes block the fast-forward", () => {
  const f = "packages/a/index.js";
  const r = withCommit("b", f, "wt\n");
  write(path.join(r, f), "local\n");
  const before = git(r, "rev-parse", "main");
  const error = String(captureError(() => finishWorktree(r, "b")));
  expect(error.startsWith(`Error: could not fast-forward main in ${r}: `)).toBe(true);
  expect(error).toContain(f);
  expect(error.trim().split("\n")).toHaveLength(1);
  expect([git(r, "rev-parse", "main"), fs.readFileSync(path.join(r, f), "utf8")]).toStrictEqual([before, "local\n"]);
  expect(fs.existsSync(wt(r, "b"))).toBe(true);
});

it("gives up after three tries when the default branch moves every time", () => {
  const r = withCommit("race");
  commitIn(r, "m.txt");
  plantHook(r, "post-rewrite", [
    `git -c user.email=t@t -c user.name=t -C '${shPath(r)}' commit -q --allow-empty -m raced`,
  ]);
  expect(() => finishWorktree(r, "race")).toThrow("main kept moving while finishing wt/race; run finish again");
  const subjects = git(r, "log", "--format=%s", "main").split("\n");
  expect(subjects.filter((s) => s === "raced")).toHaveLength(3);
  expect([hasBranch(r, "wt/race"), fs.existsSync(wt(r, "race"))]).toStrictEqual([true, true]);
});

it("stops with git's reason when it cannot remove the worktree, and a rerun still lands", () => {
  const r = withCommit("l");
  git(r, "worktree", "lock", wt(r, "l"));
  expect(() => finishWorktree(r, "l")).toThrow(/^could not remove .*l: fatal: cannot remove a locked working tree/);
  git(r, "worktree", "unlock", wt(r, "l"));
  expect(finishWorktree(r, "l").branch).toBe("wt/l");
  expect(hasBranch(r, "wt/l")).toBe(false);
});

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}
