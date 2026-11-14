/**
 * `finish` under the pull-request workflow: push `wt/<name>` and open its pull request, then, once gh shows it merged,
 * fast-forward the default branch to origin's and remove the worktree and both copies of the branch.
 */
import path from "node:path";

import { z } from "zod";

import { LAST } from "../config.constants.ts";
import { ghJson } from "./ci-wait-poll.ts";
import type { Runner } from "./ci-wait-run.ts";
import { GH_LOGIN } from "./ci-wait.constants.ts";
import {
  checkReady,
  dropBranch,
  finished,
  isAhead,
  noWorktree,
  nothingNamed,
  removeWorktreeDir,
  retired,
  shortTip,
  syncIfOut,
} from "./worktree-finish-steps.ts";
import { branchExists, fastForwardTo, git, gitReason, rebaseOnto, remoteGit, REMOTES_REF } from "./worktree-git.ts";
import { HEADS_REF, WORKTREE_CMD } from "./worktree.constants.ts";
import type {
  FinishResult,
  Finishing,
  GitRun,
  LocalFinish,
  PullRequest,
  PullRequestFinish,
  WorktreeEntry,
} from "./worktree.types.ts";

const PR_FIELDS = "state,url,number,headRefOid";

/** gh's `pr list --json` rows. */
function prListSchema() {
  return z.array(
    z.object({
      headRefOid: z.string(),
      number: z.number(),
      state: z.enum(["OPEN", "MERGED", "CLOSED"]),
      url: z.string(),
    }),
  );
}

/** `branch`'s newest pull request in any state, or null when it has none; throws `GH_LOGIN` when gh fails. */
export function findPullRequest(gh: Runner, root: string, branch: string): PullRequest | null {
  const args = ["pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", PR_FIELDS];
  const found = ghJson(gh(args, root), prListSchema());

  if (found === null) throw new Error(GH_LOGIN);
  const [pr] = found;

  return pr === undefined ? null : { head: pr.headRefOid, number: pr.number, state: pr.state, url: pr.url };
}

/** Open a pull request of `f`'s branch into its default branch, its title and body from the commits; its URL. */
export function openPullRequest(gh: Runner, f: Finishing): string {
  const made = gh(["pr", "create", "--base", f.target, "--head", f.branch, "--fill"], f.dest);

  if (made.code !== 0) {
    const reason = made.stderr.trim().split("\n").join(" ");

    throw new Error(`could not open a pull request for ${f.branch}: ${reason}; fix that, then run finish again`);
  }

  // gh prints the new pull request's URL as its last line.
  return made.stdout.trim().split("\n").slice(LAST).join("");
}

/** Throw git's reason unless `run` succeeded at what `what` names. */
function mustSucceed(run: GitRun, what: string): void {
  if (!run.ok) throw new Error(`could not ${what}: ${gitReason(run.err)}; fix that, then run finish again`);
}

/**
 * Clean up after `pr` merged: refuse a branch with commits the pull request lacks, fast-forward the default branch to
 * origin's, remove the worktree and both copies of the branch, and sync the root. Each step skips what a crashed run
 * already did, so a rerun converges.
 */
function landMerged(f: Finishing, entry: WorktreeEntry | undefined, pr: PullRequest): PullRequestFinish {
  const held = branchExists(f.root, f.branch);

  // A squash merge is no ancestor of the branch, so the branch is checked against the pull request's head instead.
  if (held && !git(f.root, ["merge-base", "--is-ancestor", HEADS_REF + f.branch, pr.head]).ok) {
    throw new Error(
      `${f.branch} has commits its merged pull request ${pr.url} lacks: run ${WORKTREE_CMD} add ` +
        `${path.basename(f.dest)}2, cherry-pick them there, then run finish ${path.basename(f.dest)} again to clean up`,
    );
  }

  if (entry !== undefined) checkReady(f, entry);
  const forwarded = fastForwardTo(f.root, REMOTES_REF + f.target, f.target);
  mustSucceed(forwarded, `fast-forward ${f.target} in ${f.root} to origin/${f.target}`);

  if (entry !== undefined) removeWorktreeDir(f.root, f.dest);

  if (held) dropBranch(f.root, f.branch);
  syncIfOut(f.root, f.target);

  return { ...finished(f), kind: "landed", sha: shortTip(f.root, f.target), url: pr.url };
}

/**
 * Origin's tip of `f`'s branch as just fetched, or "" when origin has none; throws when it holds commits the local
 * branch lacks, so neither the rebase nor the push drops them.
 */
function originTip(f: Finishing): string {
  const theirs = git(f.root, ["rev-parse", "--verify", "-q", REMOTES_REF + f.branch]).out;

  if (theirs !== "" && !git(f.root, ["merge-base", "--is-ancestor", theirs, HEADS_REF + f.branch]).ok) {
    throw new Error(
      `origin's ${f.branch} has commits ${f.branch} lacks: ` +
        `run git -C ${f.dest} pull --rebase origin ${f.branch}, then run finish again`,
    );
  }

  return theirs;
}

/**
 * Rebase the branch onto origin's default branch and push it, the lease pinned to origin's tip as fetched (absent
 * when origin has none); null once pushed, else the retired finish of a branch with nothing ahead, as a local finish
 * retires it. Each step repeats safely.
 */
function publish(f: Finishing, entry: WorktreeEntry | undefined): LocalFinish | null {
  const upstream: Finishing = { ...f, target: `origin/${f.target}` };
  let theirs = "";

  if (entry !== undefined) {
    checkReady(f, entry);
    theirs = originTip(f);
    rebaseOnto(f.dest, f.branch, upstream.target);
  }

  if (!isAhead(upstream)) return retired(f, entry);

  if (entry === undefined) throw noWorktree(f);
  const lease = `--force-with-lease=${f.branch}:${theirs}`;
  mustSucceed(remoteGit(f.dest, ["push", lease, "-u", "origin", f.branch]), `push ${f.branch}`);

  return null;
}

/**
 * Finish `f` under the pull-request workflow, driven by its pull request's state: merged lands it, closed refuses, and
 * open or none pushes it and opens one when none is open.
 */
export function finishByPullRequest(f: Finishing, entry: WorktreeEntry | undefined, gh: Runner): FinishResult {
  mustSucceed(remoteGit(f.root, ["fetch", "--prune", "origin"]), "fetch origin");
  const pr = findPullRequest(gh, f.root, f.branch);

  if (pr?.state === "MERGED") return landMerged(f, entry, pr);

  if (pr?.state === "CLOSED") {
    throw new Error(
      `the pull request for ${f.branch} was closed without merging (${pr.url}): ` +
        `reopen it with gh pr reopen ${pr.number}, then run finish again`,
    );
  }

  if (entry === undefined && !branchExists(f.root, f.branch)) throw nothingNamed(path.basename(f.dest));
  const left = publish(f, entry);

  if (left !== null) return left;
  const done = { ...finished(f), sha: shortTip(f.root, f.branch) };

  if (pr !== null) return { ...done, kind: "updated", url: pr.url };

  return { ...done, kind: "opened", url: openPullRequest(gh, f) };
}
