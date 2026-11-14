import fs from "node:fs";
import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import { readWorkflow } from "../workflow.ts";
import { spawnRunner } from "./ci-wait-run.ts";
import { canonicalPath } from "./workspace-root.ts";
import {
  checkReady,
  dropBranch,
  finished,
  isAhead,
  noWorktree,
  nothingNamed,
  retire,
  retired,
  shortTip,
  syncIfOut,
} from "./worktree-finish-steps.ts";
import {
  branchExists,
  defaultBranch,
  fastForward,
  git,
  gitReason,
  hasOwnCommits,
  isManaged,
  isMerged,
  liveEntry,
  rebaseOnto,
  requireName,
  tipOf,
  worktreeEntries,
  worktreeOf,
} from "./worktree-git.ts";
import { finishByPullRequest } from "./worktree-pr.ts";
import { copyIncluded, createWorktree, installDependencies } from "./worktree-setup.ts";
import { WorktreeUsageError } from "./worktree-usage-error.ts";
import { BRANCH_PREFIX, HEADS_REF, MAX_FINISH_TRIES, NO_BRANCH, WORKTREES_DIR } from "./worktree.constants.ts";
import type {
  FinishDeps,
  FinishResult,
  Finishing,
  LocalFinish,
  Pruned,
  WorktreeEntry,
  WorktreeInfo,
} from "./worktree.types.ts";

/** The worktree `addWorktree` made or reused, its branch, and whether it is new. */
export type WorktreeMade = { path: string; branch: string; created: boolean };

/** Make or reuse `<root>/.worktrees/<name>` on `wt/<name>`; throws a one-line message when it cannot. */
export function addWorktree(root: string, raw: string | undefined): WorktreeMade {
  const name = requireName(raw);
  const dest = path.join(root, WORKTREES_DIR, name);
  const branch = BRANCH_PREFIX + name;
  const isNew = liveEntry(root, dest) === undefined;

  if (isNew) createWorktree(root, dest, branch);
  copyIncluded(root, dest);

  if (isNew) installDependencies(root, dest);

  return { branch, created: isNew, path: canonicalPath(dest) };
}

function stateOf(dir: string): WorktreeInfo["state"] {
  if (!fs.existsSync(dir)) return "missing";

  return git(dir, ["status", "--porcelain"]).out === "" ? "clean" : "dirty";
}

export function listWorktrees(root: string): WorktreeInfo[] {
  return worktreeEntries(root)
    .slice(1)
    .map((e): WorktreeInfo => {
      const merged = e.branch !== null && hasOwnCommits(root, e.branch) && isMerged(root, e.branch);

      return { branch: e.branch, managed: isManaged(e.path, root), merged, path: e.path, state: stateOf(e.path) };
    });
}

/** The name `finish` works on: `raw`, or the worktree `cwd` is in when `raw` is undefined. */
function finishName(root: string, raw: string | undefined, cwd: string): string {
  const name = raw === undefined ? worktreeOf(canonicalPath(path.resolve(cwd)), root, path) : requireName(raw);

  if (name === null || name === "")
    throw new WorktreeUsageError("run finish inside .worktrees/<name> or pass its name");

  return name;
}

/** Rebase and fast-forward until the default branch holds the branch, retrying while the default branch moves. */
function land(f: Finishing): void {
  for (let attempt = 1; ; attempt++) {
    const before = tipOf(f.root, f.target);
    rebaseOnto(f.dest, f.branch, f.target);
    const forwarded = fastForward(f.root, f.branch, f.target);

    if (forwarded.ok) return;

    if (tipOf(f.root, f.target) === before)
      throw new Error(`could not fast-forward ${f.target} in ${f.root}: ${gitReason(forwarded.err)}`);

    if (attempt === MAX_FINISH_TRIES)
      throw new Error(`${f.target} kept moving while finishing ${f.branch}; run finish again`);
  }
}

/** Land the branch, retire it, and sync the root when it has the default branch out; the landed short sha. */
function landAndRetire(f: Finishing): string {
  land(f);
  const sha = shortTip(f.root, f.branch);
  retire(f.root, f.dest, f.branch);
  syncIfOut(f.root, f.target);

  return sha;
}

/** The finish `f` of the worktree and default branch, once `name`'s worktree or branch is known to exist. */
function finishing(root: string, dest: string, branch: string): Finishing {
  const target = defaultBranch(root);

  if (target === NO_BRANCH)
    throw new Error(`${root} has no branch checked out and no origin/HEAD; check out the default branch there`);

  return { branch, dest, root, target };
}

/** Land `f` on the default branch locally, or retire it when nothing is ahead. */
function finishLocally(f: Finishing, entry: WorktreeEntry | undefined): LocalFinish {
  if (entry !== undefined) checkReady(f, entry);

  if (!isAhead(f)) return retired(f, entry);

  if (entry === undefined) throw noWorktree(f);

  return { ...finished(f), sha: landAndRetire(f) };
}

/** `finishWorktree` with its gh and workflow read swapped: `rootArg`, the name `raw` and the `cwd` it runs in. */
export type Finish = (rootArg: string, raw: string | undefined, cwd?: string) => FinishResult;

/**
 * Finish `wt/<name>` the way the root's workflow says, with `deps` for gh and the workflow read. Under worktree and
 * main, land it on the default branch and remove it: rebase inside the worktree, fast-forward the default branch,
 * remove worktree and branch, delete origin's copy, sync the root. Under pull-request, push it and open its pull
 * request, or clean up once that merged (`finishByPullRequest`). A rerun converges from any crash point. `rootArg` is
 * the main checkout; an undefined `raw` takes the name from the worktree `cwd` is in.
 */
export function finishWith(deps: FinishDeps): Finish {
  return (rootArg, raw, cwd = rootArg) => {
    const root = canonicalPath(rootArg);
    const name = finishName(root, raw, cwd);
    const read = (deps.workflow ?? readWorkflow)(root);

    if (read === "unreadable") throw new Error(`${CONFIG_FILE} failed to load: fix it, then run finish again`);
    const [dest, branch] = [path.join(root, WORKTREES_DIR, name), BRANCH_PREFIX + name];
    const entry = liveEntry(root, dest);

    if (read === "pull-request")
      return finishByPullRequest(finishing(root, dest, branch), entry, deps.gh ?? spawnRunner("gh"));

    if (entry === undefined && !branchExists(root, branch)) throw nothingNamed(name);

    return finishLocally(finishing(root, dest, branch), entry);
  };
}

/** `finishWith` the real gh and the root's repo.config.ts. */
export function finishWorktree(rootArg: string, raw: string | undefined, cwd: string = rootArg): FinishResult {
  return finishWith({})(rootArg, raw, cwd);
}

/** Remove clean managed worktrees whose commits reached the default branch, then merged `wt/*` branches left. */
export function pruneWorktrees(root: string): Pruned[] {
  const removed: Pruned[] = [];

  for (const w of listWorktrees(root)) {
    if (!w.managed || w.state !== "clean" || !w.merged || w.branch === null) continue;

    if (!git(root, ["worktree", "remove", w.path]).ok) continue;
    dropBranch(root, w.branch);
    removed.push({ branch: w.branch, path: w.path });
  }

  return [...removed, ...pruneBranches(root)];
}

/** Delete the merged `wt/*` branches no worktree holds; the ones deleted. */
function pruneBranches(root: string): Pruned[] {
  const held = new Set(worktreeEntries(root).map((e) => e.branch));
  const branches = git(root, ["for-each-ref", "--format=%(refname:short)", HEADS_REF + BRANCH_PREFIX]).out.split("\n");

  return branches
    .filter((b) => b !== "" && !held.has(b) && isMerged(root, b) && dropBranch(root, b))
    .map((branch) => ({ branch, path: null }));
}
