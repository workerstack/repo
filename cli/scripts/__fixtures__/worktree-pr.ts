/** A bare origin and a fake gh for the pull-request finish tests; gh's answers follow what origin holds. */
import path from "node:path";

import type { Runner } from "../ci-wait-run.ts";
import type { Captured } from "../lint.ts";
import { addWorktree } from "../worktree-lifecycle.ts";
import type { FinishDeps, PrState } from "../worktree.types.ts";
import { addOrigin, commitIn, git, wt, type Scratch } from "./worktree-repo.ts";

export const PR_URL = "https://github.com/o/r/pull/7";

/** A gh that answers `pr list` and `pr create` for `wt/a`, recording every call. */
export type FakeGh = {
  gh: Runner;
  calls: string[][];
  /** The pull request's state, or null before one is opened. */
  state: PrState | null;
  /** The pull request's head: origin's `wt/a` while origin has it, else the last one seen. */
  head: string;
  /** What `pr list` or `pr create` answers instead of the normal reply. */
  fail: { list?: Captured; create?: Captured };
};

/** The tip of `wt/a` on the bare origin `bare`, or "" when origin has none. */
function originTip(bare: string): string {
  try {
    return git(bare, "rev-parse", "--verify", "-q", "refs/heads/wt/a");
  } catch {
    return "";
  }
}

/** A fake gh whose pull request's head is origin's `wt/a`, kept once origin drops the branch. */
export function fakeGh(bare: string): FakeGh {
  const fake: FakeGh = { calls: [], fail: {}, gh: () => ({ code: 0, stderr: "", stdout: "" }), head: "", state: null };
  fake.gh = (args) => {
    fake.calls.push(args);
    fake.head = originTip(bare) || fake.head;
    if (args[1] === "create") {
      if (fake.fail.create !== undefined) return fake.fail.create;
      fake.state = "OPEN";
      return { code: 0, stderr: "Creating pull request for wt/a into main\n", stdout: `\n${PR_URL}\n` };
    }
    if (fake.fail.list !== undefined) return fake.fail.list;
    const prs = fake.state === null ? [] : [{ headRefOid: fake.head, number: 7, state: fake.state, url: PR_URL }];
    return { code: 0, stderr: "", stdout: JSON.stringify(prs) };
  };
  return fake;
}

/** The gh calls that were `pr create`. */
export const creates = (fake: FakeGh): string[][] => fake.calls.filter((c) => c[1] === "create");

/** A repo with a bare origin, worktree `a` holding one commit, and a fake gh. */
export function prRepo(tmp: Scratch): { r: string; bare: string; fake: FakeGh; deps: FinishDeps } {
  const r = tmp.repo();
  const bare = path.join(tmp.dir("bare-"), "origin.git");
  addOrigin(r, bare);
  addWorktree(r, "a");
  commitIn(wt(r, "a"), "a.txt");
  const fake = fakeGh(bare);
  return { bare, deps: { gh: fake.gh, workflow: () => "pull-request" }, fake, r };
}

/** Moves origin's main ahead of the local one by an empty commit named `subject`. */
export function moveOriginMain(r: string, subject: string): void {
  git(r, "fetch", "-q", "origin");
  const sha = git(r, "commit-tree", "origin/main^{tree}", "-p", "origin/main", "-m", subject);
  git(r, "push", "-q", "--no-verify", "origin", `${sha}:refs/heads/main`);
}

/** Squash-merges origin's `wt/a` into origin's main, as GitHub does, and drops origin's `wt/a` when `drop`. */
export function squashMerge(r: string, fake: FakeGh, drop: boolean): void {
  git(r, "fetch", "-q", "origin");
  const tree = git(r, "rev-parse", "origin/wt/a^{tree}");
  const sha = git(r, "commit-tree", tree, "-p", "origin/main", "-m", "a (#7)");
  git(r, "push", "-q", "--no-verify", "origin", `${sha}:refs/heads/main`);
  fake.head = git(r, "rev-parse", "origin/wt/a");
  if (drop) git(r, "push", "-q", "--no-verify", "origin", "--delete", "wt/a");
  fake.state = "MERGED";
}
