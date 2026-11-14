import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { creates, moveOriginMain, prRepo, PR_URL } from "./__fixtures__/worktree-pr.ts";
import { commitIn, git, hasBranch, scratch, write, wt } from "./__fixtures__/worktree-repo.ts";
import type { Runner } from "./ci-wait-run.ts";
import { GH_LOGIN } from "./ci-wait.constants.ts";
import { addWorktree, finishWith } from "./worktree-lifecycle.ts";
import { findPullRequest, openPullRequest } from "./worktree-pr.ts";

const tmp = scratch();

afterEach(() => tmp.cleanup());

const CREATE = ["pr", "create", "--base", "main", "--head", "wt/a", "--fill"];
const LIST = [..."pr list --head wt/a --state all --limit 1 --json".split(" "), "state,url,number,headRefOid"];

/** A gh that prints `stdout` and exits 0. */
function says(stdout: string): Runner {
  return () => ({ code: 0, stderr: "", stdout });
}

it("reads gh's newest pull request into its head, number, state and URL, and none as null", () => {
  const row = { headRefOid: "abc123", number: 7, state: "MERGED", url: PR_URL };
  expect(findPullRequest(says(JSON.stringify([row])), "/", "wt/a")).toStrictEqual({
    head: "abc123",
    number: 7,
    state: "MERGED",
    url: PR_URL,
  });
  expect(findPullRequest(says("[]"), "/", "wt/a")).toBeNull();
  expect(() => findPullRequest(says(JSON.stringify([{ ...row, state: "DRAFT" }])), "/", "wt/a")).toThrow(GH_LOGIN);
});

it("takes the URL from the last line gh pr create prints", () => {
  const f = { branch: "wt/a", dest: "/", root: "/", target: "main" };
  expect(openPullRequest(says(`Warning: 2 uncommitted changes\n${PR_URL}\n`), f)).toBe(PR_URL);
});

it("rebases onto origin's main, pushes the branch and opens its pull request once", () => {
  const { r, bare, fake, deps } = prRepo(tmp);
  moveOriginMain(r, "moved");
  const result = finishWith(deps)(r, "a");
  const tip = git(r, "rev-parse", "wt/a");
  expect(result).toStrictEqual({
    branch: "wt/a",
    defaultBranch: "main",
    kind: "opened",
    path: wt(r, "a"),
    sha: git(r, "rev-parse", "--short", tip),
    url: PR_URL,
  });
  expect(git(bare, "rev-parse", "wt/a")).toBe(tip);
  expect(git(bare, "log", "--format=%s", "wt/a").split("\n")).toStrictEqual(["a.txt", "moved", "init"]);
  expect(fake.calls).toStrictEqual([LIST, CREATE]);
  expect([fs.existsSync(wt(r, "a")), git(r, "rev-parse", "--abbrev-ref", "wt/a@{upstream}")]).toStrictEqual([
    true,
    "origin/wt/a",
  ]);
});

it("lease-pushes a rebased branch to its open pull request without opening another", () => {
  const { r, bare, fake, deps } = prRepo(tmp);
  finishWith(deps)(r, "a");
  commitIn(wt(r, "a"), "b.txt");
  moveOriginMain(r, "moved");
  expect(finishWith(deps)(r, "a")).toMatchObject({ kind: "updated", url: PR_URL });
  expect(git(bare, "rev-parse", "wt/a")).toBe(git(r, "rev-parse", "wt/a"));
  expect(git(bare, "log", "--format=%s", "wt/a").split("\n")).toStrictEqual(["b.txt", "a.txt", "moved", "init"]);
  expect(creates(fake)).toStrictEqual([CREATE]);
});

it("refuses to push over a commit origin's branch has and the local one lacks, and keeps it", () => {
  const { r, bare, deps } = prRepo(tmp);
  finishWith(deps)(r, "a");
  const clone = path.join(tmp.dir("clone-"), "c");
  git(path.dirname(clone), "clone", "-q", "-b", "wt/a", bare, clone);
  commitIn(clone, "suggested.txt");
  git(clone, "push", "-q", "--no-verify", "origin", "wt/a");
  const theirs = git(clone, "rev-parse", "HEAD");
  commitIn(wt(r, "a"), "b.txt");
  expect(() => finishWith(deps)(r, "a")).toThrow(
    `origin's wt/a has commits wt/a lacks: run git -C ${wt(r, "a")} pull --rebase origin wt/a, then run finish again`,
  );
  expect(git(bare, "rev-parse", "wt/a")).toBe(theirs);
});

it("reads the workflow from the root's repo.config.ts", () => {
  const { r, fake, deps } = prRepo(tmp);
  write(path.join(r, "repo.config.ts"), `export default { workflow: "pull-request" };\n`);
  expect(finishWith({ gh: deps.gh })(r, "a")).toMatchObject({ kind: "opened", url: PR_URL });
  expect(creates(fake)).toHaveLength(1);
});

it("retires a worktree with nothing ahead of origin's main and opens nothing", () => {
  const { r, fake, deps } = prRepo(tmp);
  addWorktree(r, "a2");
  expect(finishWith(deps)(r, "a2")).toStrictEqual({
    branch: "wt/a2",
    defaultBranch: "main",
    path: wt(r, "a2"),
    sha: null,
  });
  expect([fs.existsSync(wt(r, "a2")), hasBranch(r, "wt/a2"), creates(fake)]).toStrictEqual([false, false, []]);
});

it("refuses a branch with an open pull request but no worktree, with today's text", () => {
  const { r, deps } = prRepo(tmp);
  finishWith(deps)(r, "a");
  git(r, "worktree", "remove", wt(r, "a"));
  expect(() => finishWith(deps)(r, "a")).toThrow(
    "wt/a has commits that main lacks and no worktree: " +
      "run bun repo worktree add a to bring it back, then run finish again",
  );
});

it("names the list command when there is no pull request, worktree or branch", () => {
  const { r, fake, deps } = prRepo(tmp);
  expect(() => finishWith(deps)(r, "ghost")).toThrow(
    "no worktree or branch named ghost: bun repo worktree list shows them",
  );
  expect(fake.calls).toHaveLength(1);
});

it("throws git's reason when origin rejects the push, and opens nothing", () => {
  const { r, bare, fake, deps } = prRepo(tmp);
  write(path.join(bare, "hooks", "pre-receive"), "#!/bin/sh\necho 'no pushes here' >&2\nexit 1\n");
  fs.chmodSync(path.join(bare, "hooks", "pre-receive"), 0o755);
  expect(() => finishWith(deps)(r, "a")).toThrow(
    /^could not push wt\/a: remote: no pushes here.*; fix that, then run finish again$/,
  );
  expect(creates(fake)).toStrictEqual([]);
});

it("throws gh's reason when the pull request cannot be opened", () => {
  const { r, fake, deps } = prRepo(tmp);
  fake.fail.create = { code: 1, stderr: "GraphQL: No commits between main and wt/a\n", stdout: "" };
  expect(() => finishWith(deps)(r, "a")).toThrow(
    "could not open a pull request for wt/a: GraphQL: No commits between main and wt/a; " +
      "fix that, then run finish again",
  );
});

it("asks for a gh login when gh cannot list pull requests", () => {
  const { r, fake, deps } = prRepo(tmp);
  fake.fail.list = { code: 4, stderr: "To get started with GitHub CLI, please run: gh auth login\n", stdout: "" };
  expect(() => finishWith(deps)(r, "a")).toThrow("gh is not installed or not logged in; run `gh auth login`");
  expect(hasBranch(r, "wt/a")).toBe(true);
});

it("throws git's reason when origin cannot be fetched, before any gh, the real one included", () => {
  const { r, fake, deps } = prRepo(tmp);
  git(r, "remote", "remove", "origin");
  const noOrigin = "fatal: 'origin' does not appear to be a git repository";
  const fetchFailed = new RegExp(`^could not fetch origin: ${noOrigin}.*; fix that, then run finish again$`);

  expect(() => finishWith(deps)(r, "a")).toThrow(fetchFailed);
  expect(() => finishWith({ workflow: () => "pull-request" })(r, "a")).toThrow(fetchFailed);
  expect(fake.calls).toStrictEqual([]);
});

it("refuses to finish when repo.config.ts does not load, before any git or gh", () => {
  const { r, fake } = prRepo(tmp);
  expect(() => finishWith({ gh: fake.gh, workflow: () => "unreadable" })(r, "a")).toThrow(
    "repo.config.ts failed to load: fix it, then run finish again",
  );
  expect([fake.calls, fs.existsSync(wt(r, "a"))]).toStrictEqual([[], true]);
});

it.each(["worktree", "main"] as const)("merges locally under the %s workflow and never calls gh", (workflow) => {
  const { r, fake } = prRepo(tmp);
  const tip = git(wt(r, "a"), "rev-parse", "HEAD");
  expect(finishWith({ gh: fake.gh, workflow: () => workflow })(r, "a")).toStrictEqual({
    branch: "wt/a",
    defaultBranch: "main",
    path: wt(r, "a"),
    sha: git(r, "rev-parse", "--short", tip),
  });
  expect([git(r, "rev-parse", "main"), fake.calls]).toStrictEqual([tip, []]);
});
