import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { at, cli, scratch, shared, wt } from "./__fixtures__/worktree-repo.ts";

const tmp = scratch();

afterEach(() => tmp.cleanup());

const commitMaking = {
  am: "git am p.patch",
  "cherry-pick": "git cherry-pick abc",
  commit: "git commit -m x",
  merge: "git merge wt/a",
  pull: "git pull",
  revert: "git revert HEAD",
};

const destructive = {
  checkout: "git checkout main",
  clean: "git clean -fd",
  rebase: "git rebase main",
  reset: "git reset --hard",
  restore: "git restore f",
  stash: "git stash",
  switch: "git switch main",
};

function withWorktrees(): string {
  const r = tmp.repo();
  cli(r, ["add", "a"]);
  cli(r, ["add", "b"]);

  return r;
}

it("denies the 13 commit-making and destructive subcommands in the main checkout, and a named one passes", () => {
  const r = withWorktrees();
  const main = at(r);

  for (const [sub, cmd] of Object.entries(commitMaking)) {
    expect(shared(cmd, main), cmd).toBe(
      `the main checkout is shared: commit inside ${path.join(r, ".worktrees", "<name>")}, ` +
        "then run bun repo worktree finish <name>",
    );
    expect(shared(cmd, main, new Set([sub])), `${cmd} asked`).toBeNull();
    expect(shared(cmd, main, new Set(["stash"])), `${cmd} other word`).not.toBeNull();
  }

  for (const [sub, cmd] of Object.entries(destructive)) {
    expect(shared(cmd, main), cmd).toBe(
      `git ${sub} in the main checkout can destroy other sessions' work: do it inside your worktree, ` +
        `or run it here only when the user's message asks for git ${sub}`,
    );
    expect(shared(cmd, main, new Set([sub])), `${cmd} asked`).toBeNull();
  }

  expect(shared("cd packages/a && git stash", main)).not.toBeNull();
  expect(shared("git -C packages/a commit -m x", main)).not.toBeNull();
  expect(shared("git -c core.editor=true commit -m x", main)).not.toBeNull();
  expect(shared("git add -A && git commit -m x", main)).not.toBeNull();
});

const OWN_WORKTREE = [
  "git stash",
  "git reset --hard",
  "git checkout main",
  "git rebase main",
  "git commit --amend",
  "git clean -fd",
];

it("lets every git command run inside your own worktree and denies the main checkout from there", () => {
  const r = withWorktrees();
  const a = wt(r, "a");

  for (const cmd of OWN_WORKTREE) {
    expect(shared(`cd .worktrees/a && ${cmd}`, at(r)), cmd).toBeNull();
    expect(shared(cmd.replace("git ", "git -C .worktrees/a "), at(r)), cmd).toBeNull();
    expect(shared(cmd, at(r, a)), cmd).toBeNull();
  }

  expect(shared("git -C packages/a stash", at(r, a, path.join(a, "packages/a")))).toBeNull();
  expect(shared(`git -C ${r.split(path.sep).join("/")} commit -m x`, at(r, a))).toMatch(
    /^the main checkout is shared: commit inside /,
  );
  expect(shared("git -C ../.. stash", at(r, a))).toMatch(/^git stash in the main checkout /);
  expect(shared("git status && git log --oneline && git diff && git add -A && git worktree list", at(r))).toBeNull();
  expect(shared('git -C "$DIR" stash', at(r))).toMatch(/^git stash in the main checkout /);
});

it("frees other worktrees and wt/* branches", () => {
  const r = withWorktrees();
  const from = at(r, wt(r, "a"));
  expect(shared("git branch -D wt/b", from)).toBeNull();
  expect(shared("git branch -m wt/b renamed", from)).toBeNull();
  expect(shared("git branch -D wt/b", at(r))).toBeNull();
  expect(shared("git branch -d scratch wt/b", from)).toBeNull();
  expect(shared("git branch -D scratch wt/b main", from)).toMatch(/^main is the shared default branch/);
  expect(shared("git worktree remove .worktrees/b", from)).toBeNull();
  expect(shared("git worktree remove ../b", from)).toBeNull();
  expect(shared("git worktree remove --force .worktrees/b", at(r))).toBeNull();
  expect(shared(`git worktree remove ${wt(r, "b").split(path.sep).join("/")}`, from)).toBeNull();
  expect(shared("git push --force origin wt/b", from)).toMatch(/^a force push rewrites shared history/);
  expect(shared("git branch -D wt/b", from, new Set(["branch"]))).toBeNull();
  expect(shared("git worktree remove ../b", from, new Set(["worktree"]))).toBeNull();
});

const DEFAULT_BRANCH_MOVES: [string, string][] = [
  ["git branch -D main", "branch"],
  ["git branch -d main", "branch"],
  ["git branch -M main", "branch"],
  ["git branch -f main HEAD~1", "branch"],
  ["git update-ref refs/heads/main x", "update-ref"],
  ["git update-ref -d refs/heads/main", "update-ref"],
];

const FREE_BRANCH_WORK = [
  "git branch -D scratch",
  "git branch -f scratch main",
  "git branch scratch main",
  "git branch -D wt/a",
  "git branch --list",
  "git branch -vv",
  "git worktree remove ../a",
  "git worktree remove .worktrees/a",
  "git worktree remove /somewhere/else",
  "git update-ref refs/heads/scratch x",
  "git update-ref refs/stash x",
];

it("guards the default branch from anywhere unless its subcommand was asked", () => {
  const r = withWorktrees();
  const from = at(r, wt(r, "a"));

  for (const [cmd, sub] of DEFAULT_BRANCH_MOVES) {
    const reason =
      "main is the shared default branch: move it only with bun repo worktree finish <name>, " +
      `or when the user's message asks for git ${sub}`;

    expect(shared(cmd, from), cmd).toBe(reason);
    expect(shared(cmd, at(r)), cmd).toBe(reason);
    expect(shared(cmd, from, new Set([sub])), `${cmd} asked`).toBeNull();
  }

  for (const cmd of FREE_BRANCH_WORK) expect(shared(cmd, from), cmd).toBeNull();
});

const FORCED = [
  "git push --force",
  "git push -f",
  "git push origin +main",
  "git push --force-with-lease origin main",
  "git push -fu origin main",
  "git push origin main:main +wt/a",
];

const UNFORCED = [
  "git push",
  "git push origin main",
  "git push -u origin HEAD",
  "git push --follow-tags",
  "git push --delete origin x",
];

it("denies a force push anywhere in the repo unless force was asked", () => {
  const r = withWorktrees();
  const reason = "a force push rewrites shared history: run it only when the user's message asks for a force push";

  for (const cmd of FORCED) {
    for (const place of [at(r), at(r, wt(r, "a"))]) {
      expect(shared(cmd, place), cmd).toBe(reason);
      expect(shared(cmd, place, new Set(["force"])), `${cmd} asked`).toBeNull();
      expect(shared(cmd, place, new Set(["push"])), `${cmd} wrong word`).toBe(reason);
    }
  }

  for (const cmd of UNFORCED) expect(shared(cmd, at(r)), cmd).toBeNull();
  expect(shared("git -C /somewhere/else push --force", at(r))).toBeNull();
});
