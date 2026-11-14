import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { removeTree } from "../remove-tree.ts";
import { commitIn, git, hasBranch, plantHook, scratch, shPath, wt } from "./__fixtures__/worktree-repo.ts";
import { expectOnlyMainWorktree } from "./__fixtures__/worktree-scenarios.ts";
import { addWorktree, finishWorktree } from "./worktree-lifecycle.ts";

const tmp = scratch();

afterEach(() => tmp.cleanup());

function subjects(r: string) {
  return git(r, "log", "--format=%s", "main").split("\n");
}

/** A repo with worktree `name` holding one commit of its own. */
function withCommit(name = "a"): string {
  const r = tmp.repo();
  addWorktree(r, name);
  commitIn(wt(r, name), `${name}.txt`);

  return r;
}

it("fast-forwards the default branch to the worktree's commit, then removes worktree and branch", () => {
  const r = withCommit();
  const tip = git(wt(r, "a"), "rev-parse", "HEAD");
  const result = finishWorktree(r, "a");
  expect(result).toStrictEqual({
    branch: "wt/a",
    defaultBranch: "main",
    path: wt(r, "a"),
    sha: git(r, "rev-parse", "--short", tip),
  });
  expect(git(r, "rev-parse", "main")).toBe(tip);
  expect(git(r, "branch", "--show-current")).toBe("main");
  expect(fs.readFileSync(path.join(r, "a.txt"), "utf8")).toBe("a.txt");
  expect([fs.existsSync(wt(r, "a")), hasBranch(r, "wt/a")]).toStrictEqual([false, false]);
});

it("rebases onto a default branch that moved and leaves a linear history", () => {
  const r = withCommit();
  commitIn(r, "m.txt");
  finishWorktree(r, "a");
  expect(git(r, "rev-list", "--merges", "main")).toBe("");
  expect(subjects(r)).toStrictEqual(["a.txt", "m.txt", "init"]);
  expect(hasBranch(r, "wt/a")).toBe(false);
});

it("removes a worktree with no commits of its own and reports no sha", () => {
  const r = tmp.repo();
  addWorktree(r, "empty");
  commitIn(r, "m.txt");
  const before = git(r, "rev-parse", "main");
  expect(finishWorktree(r, "empty")).toStrictEqual({
    branch: "wt/empty",
    defaultBranch: "main",
    path: wt(r, "empty"),
    sha: null,
  });
  expect(git(r, "rev-parse", "main")).toBe(before);
  expect([fs.existsSync(wt(r, "empty")), hasBranch(r, "wt/empty")]).toStrictEqual([false, false]);
});

it("converges when a crashed run left the work merged, with the worktree gone or still there", () => {
  const r = withCommit("gone");
  git(r, "merge", "-q", "--ff-only", "wt/gone");
  git(r, "worktree", "remove", wt(r, "gone"));
  const rerun = finishWorktree(r, "gone");
  expect(rerun.sha).toMatch(/^[0-9a-f]+$/);
  expect(hasBranch(r, "wt/gone")).toBe(false);
  addWorktree(r, "kept");
  commitIn(wt(r, "kept"), "kept.txt");
  git(r, "merge", "-q", "--ff-only", "wt/kept");
  finishWorktree(r, "kept");
  expect([fs.existsSync(wt(r, "kept")), hasBranch(r, "wt/kept")]).toStrictEqual([false, false]);
  expect(() => finishWorktree(r, "kept")).toThrow("no worktree or branch named kept");
});

it("unregisters a worktree whose dir another session deleted, then finishes the merged branch", () => {
  const r = tmp.repo();
  addWorktree(r, "lost");
  removeTree(wt(r, "lost"));
  expect(finishWorktree(r, "lost").sha).toBeNull();
  expectOnlyMainWorktree(r);
  expect(hasBranch(r, "wt/lost")).toBe(false);
});

it("advances the default ref through the ref while the main checkout sits on another branch", () => {
  const r = withCommit("o");
  git(r, "update-ref", "refs/remotes/origin/main", "main");
  git(r, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git(r, "switch", "-q", "-c", "other");
  const tip = git(wt(r, "o"), "rev-parse", "HEAD");
  finishWorktree(r, "o");
  expect(git(r, "rev-parse", "main")).toBe(tip);
  expect(git(r, "branch", "--show-current")).toBe("other");
  expect(fs.existsSync(path.join(r, "o.txt"))).toBe(false);
});

it("takes the name from the worktree it is run in, and leaves that dir before removing it", () => {
  const r = withCommit("n");
  const inside = path.join(wt(r, "n"), "packages/a");
  expect(finishWorktree(r, undefined, inside).branch).toBe("wt/n");
  addWorktree(r, "m");
  process.chdir(wt(r, "m"));
  finishWorktree(r, "m");
  expect(process.cwd()).toBe(r);
  expect(fs.existsSync(wt(r, "m"))).toBe(false);
});

it("retries the rebase once when the default branch moves during it", () => {
  const r = withCommit("race");
  commitIn(r, "m.txt");
  const marker = shPath(path.join(r, ".git", "raced"));
  const commit = `git -c user.email=t@t -c user.name=t -C '${shPath(r)}' commit -q --allow-empty -m raced`;
  plantHook(r, "post-rewrite", [`[ -e '${marker}' ] && exit 0`, `: > '${marker}'`, commit]);
  finishWorktree(r, "race");
  expect(subjects(r)).toStrictEqual(["race.txt", "raced", "m.txt", "init"]);
  expect(hasBranch(r, "wt/race")).toBe(false);
});

it("keeps a branch the default branch no longer holds after the fast-forward", () => {
  const r = withCommit("back");
  const before = git(r, "rev-parse", "main");
  plantHook(r, "post-merge", [`git -C '${shPath(r)}' update-ref refs/heads/main ${before}`]);
  finishWorktree(r, "back");
  expect(git(r, "rev-parse", "main")).toBe(before);
  expect(hasBranch(r, "wt/back")).toBe(true);
});

it("finishes when another session removed the worktree right after the fast-forward", () => {
  const r = withCommit("p");
  const tip = git(wt(r, "p"), "rev-parse", "HEAD");
  plantHook(r, "post-merge", [`git -C '${shPath(r)}' worktree remove --force '${shPath(wt(r, "p"))}'`]);
  expect(finishWorktree(r, "p").sha).toBe(git(r, "rev-parse", "--short", tip));
  expect(git(r, "rev-parse", "main")).toBe(tip);
  expect(hasBranch(r, "wt/p")).toBe(false);
  expectOnlyMainWorktree(r);
});
