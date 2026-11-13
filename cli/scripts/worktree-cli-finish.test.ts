import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  addOrigin,
  cli,
  commitIn,
  git,
  hasBranch,
  hasTracking,
  scratch,
  short,
  subjects,
  write,
  wt,
} from "./__fixtures__/worktree-repo.ts";

const tmp = scratch();

afterEach(() => tmp.cleanup());

it("fast-forwards the default branch with one commit and removes the worktree and branch", () => {
  const r = tmp.repo();
  cli(r, ["add", "a"]);
  commitIn(wt(r, "a"), "a.txt");
  const tip = git(wt(r, "a"), "rev-parse", "HEAD");
  const out = cli(r, ["finish", "a"]);
  expect(out.status, out.stderr).toBe(0);
  expect(out.stdout).toBe(
    `merged wt/a into main at ${short(r, "main")} and removed ${wt(r, "a")}; your shell may still be in it: cd ${r}\n`,
  );
  expect(git(r, "rev-parse", "main")).toBe(tip);
  expect(git(r, "branch", "--show-current")).toBe("main");
  expect(fs.readFileSync(path.join(r, "a.txt"), "utf8")).toBe("a.txt");
  expect(fs.existsSync(wt(r, "a"))).toBe(false);
  expect(hasBranch(r, "wt/a")).toBe(false);
});

it("rebases onto a default branch that moved, leaving a linear history", () => {
  const r = tmp.repo();
  cli(r, ["add", "a"]);
  commitIn(wt(r, "a"), "a.txt");
  commitIn(r, "m.txt");
  const out = cli(r, ["finish", "a"]);
  expect(out.status, out.stderr).toBe(0);
  expect(git(r, "rev-list", "--merges", "main")).toBe("");
  expect(subjects(r)).toStrictEqual(["a.txt", "m.txt", "init"]);
  expect(fs.existsSync(path.join(r, "m.txt")) && fs.existsSync(path.join(r, "a.txt"))).toBe(true);
  expect(hasBranch(r, "wt/a")).toBe(false);
});

it("aborts a conflicting rebase, names the file and keeps the worktree", () => {
  const r = tmp.repo();
  cli(r, ["add", "c"]);
  commitIn(wt(r, "c"), "packages/a/index.js", "wt\n");
  commitIn(r, "packages/a/index.js", "main\n");
  const before = git(r, "rev-parse", "main");
  const w = wt(r, "c");
  const out = cli(r, ["finish", "c"]);
  expect(out.status).toBe(1);
  expect(out.stdout).toBe("");
  expect(out.stderr).toBe(
    `rebasing wt/c onto main conflicts in packages/a/index.js: run git -C ${w} rebase main, fix each file, ` +
      `git -C ${w} add <file>, git -C ${w} rebase --continue, rerun the checks, then run finish again\n`,
  );
  expect(git(r, "rev-parse", "main")).toBe(before);
  expect(git(w, "branch", "--show-current")).toBe("wt/c");
  expect(git(w, "status", "--porcelain")).toBe("");
  expect(hasBranch(r, "wt/c")).toBe(true);
  expect(cli(r, ["finish", "c"]).stderr).toContain("conflicts in packages/a/index.js");
});

it("refuses a worktree that is mid-rebase", () => {
  const r = tmp.repo();
  cli(r, ["add", "c"]);
  const w = wt(r, "c");
  commitIn(w, "packages/a/index.js", "wt\n");
  commitIn(r, "packages/a/index.js", "main\n");
  const before = git(r, "rev-parse", "main");
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "rebase", "main"], { cwd: w });
  const out = cli(r, ["finish", "c"]);
  expect(out.status).toBe(1);
  expect(out.stderr).toBe(
    `${w} is mid-rebase: finish it with git -C ${w} rebase --continue (or --abort), then run finish again\n`,
  );
  expect(git(r, "rev-parse", "main")).toBe(before);
  expect(fs.existsSync(w)).toBe(true);
});

it("refuses uncommitted changes, untracked files included, and moves nothing", () => {
  const r = tmp.repo();
  cli(r, ["add", "d"]);
  const w = wt(r, "d");
  commitIn(w, "d.txt");
  const before = git(r, "rev-parse", "main");
  write(path.join(w, "packages/a/index.js"), "edited\n");
  write(path.join(w, "loose.txt"), "x");
  const two = cli(r, ["finish", "d"]);
  expect(two.status).toBe(1);
  expect(two.stderr).toBe(`${w} has uncommitted changes in 2 files: commit or drop them, then run finish again\n`);
  git(w, "checkout", "-q", "--", "packages/a/index.js");
  const one = cli(r, ["finish", "d"]);
  expect(one.status).toBe(1);
  expect(one.stderr).toBe(`${w} has uncommitted changes in 1 file: commit or drop them, then run finish again\n`);
  expect(git(r, "rev-parse", "main")).toBe(before);
  expect(hasBranch(r, "wt/d")).toBe(true);
  expect(fs.existsSync(w)).toBe(true);
});

it("removes a worktree with no commits of its own and says so", () => {
  const r = tmp.repo();
  cli(r, ["add", "empty"]);
  commitIn(r, "m.txt");
  const before = git(r, "rev-parse", "main");
  const out = cli(r, ["finish", "empty"]);
  expect(out.status, out.stderr).toBe(0);
  expect(out.stdout).toBe(`wt/empty has no commits of its own; removed ${wt(r, "empty")}\n`);
  expect(git(r, "rev-parse", "main")).toBe(before);
  expect(fs.existsSync(wt(r, "empty"))).toBe(false);
  expect(hasBranch(r, "wt/empty")).toBe(false);
});

it("names the list command for an unknown worktree", () => {
  const r = tmp.repo();
  const out = cli(r, ["finish", "nosuch"]);
  expect(out.status).toBe(1);
  expect(out.stderr).toBe(`no worktree or branch named nosuch: bun repo worktree list shows them\n`);
});

it("converges when a crashed run left the work merged", () => {
  const r = tmp.repo();
  cli(r, ["add", "gone"]);
  commitIn(wt(r, "gone"), "gone.txt");
  git(r, "merge", "-q", "--ff-only", "wt/gone");
  git(r, "worktree", "remove", wt(r, "gone"));
  const before = git(r, "rev-parse", "main");
  const rerun = cli(r, ["finish", "gone"]);
  expect(rerun.status, rerun.stderr).toBe(0);
  expect(rerun.stdout).toContain("merged wt/gone into main at ");
  expect(hasBranch(r, "wt/gone")).toBe(false);
  expect(git(r, "rev-parse", "main")).toBe(before);
  cli(r, ["add", "kept"]);
  commitIn(wt(r, "kept"), "kept.txt");
  git(r, "merge", "-q", "--ff-only", "wt/kept");
  const again = cli(r, ["finish", "kept"]);
  expect(again.status, again.stderr).toBe(0);
  expect(fs.existsSync(wt(r, "kept"))).toBe(false);
  expect(hasBranch(r, "wt/kept")).toBe(false);
  expect(cli(r, ["finish", "kept"]).status).toBe(1);
});

/** A repo with worktree `a` holding one commit and an origin that holds `branches`; `broken` points origin nowhere. */
function withOrigin(branches: string[], { broken = false }: { broken?: boolean } = {}): string {
  const r = tmp.repo();
  cli(r, ["add", "a"]);
  commitIn(wt(r, "a"), "a.txt");
  addOrigin(r, tmp.dir("origin-"), branches);

  if (broken) git(r, "remote", "set-url", "origin", path.join(r, "no-such-origin"));

  return r;
}

it("deletes origin's branch and its tracking ref when it lands", () => {
  const r = withOrigin(["wt/a"]);
  const out = cli(r, ["finish", "a"]);
  expect(out.status, out.stderr).toBe(0);
  expect(out.stderr).toBe("");
  expect(git(r, "ls-remote", "--heads", "origin", "wt/a")).toBe("");
  expect(hasTracking(r, "wt/a")).toBe(false);
  expect(hasBranch(r, "wt/a")).toBe(false);
});

it("warns and still lands when origin cannot be reached", () => {
  const r = withOrigin(["wt/a"], { broken: true });
  const tip = git(wt(r, "a"), "rev-parse", "HEAD");
  const out = cli(r, ["finish", "a"]);
  expect(out.status, out.stderr).toBe(0);
  expect(out.stderr).toMatch(/^could not delete origin's wt\/a: .+; run git push origin --delete wt\/a\n$/);
  expect(git(r, "rev-parse", "main")).toBe(tip);
  expect(hasBranch(r, "wt/a")).toBe(false);
});

it("skips the delete when origin has no tracking ref of the branch", () => {
  const r = withOrigin([], { broken: true });
  const out = cli(r, ["finish", "a"]);
  expect(out.status, out.stderr).toBe(0);
  expect(out.stderr).toBe("");
});
