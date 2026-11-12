import fs from "node:fs";
import path from "node:path";

import { canonicalPath } from "./workspace-root.ts";
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
  rebaseInProgress,
  rebaseOnto,
  requireName,
  tipOf,
  worktreeEntries,
  worktreeOf,
} from "./worktree-git.ts";
import { copyIncluded, createWorktree, installDependencies } from "./worktree-setup.ts";
import { WorktreeUsageError } from "./worktree-usage-error.ts";
import {
  BRANCH_PREFIX,
  HEADS_REF,
  MAX_FINISH_TRIES,
  NO_BRANCH,
  NOTHING_AHEAD,
  WORKTREE_CMD,
  WORKTREES_DIR,
} from "./worktree.constants.ts";
import type { FinishResult, Finishing, Pruned, WorktreeEntry, WorktreeInfo } from "./worktree.types.ts";

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

/** Remove the worktree dir (never forced), or only unregister it when another session's prune got there first. */
function removeWorktreeDir(root: string, worktree: string): void {
  // win32 refuses to delete a dir that is any process's cwd, this one included when finish ran inside it.
  const fromInside = path.relative(canonicalPath(worktree), canonicalPath(process.cwd()));

  if (!fromInside.startsWith("..") && !path.isAbsolute(fromInside)) process.chdir(root);

  if (!fs.existsSync(worktree)) {
    git(root, ["worktree", "prune"]);

    return;
  }

  const removed = git(root, ["worktree", "remove", worktree]);

  if (!removed.ok)
    throw new Error(`could not remove ${worktree}: ${gitReason(removed.err)}; fix that, then run finish again`);
}

/** Remove the worktree, if any, then delete the branch once the default branch holds it. */
function retire(root: string, worktree: string | undefined, branch: string): void {
  if (worktree !== undefined) removeWorktreeDir(root, worktree);

  if (isMerged(root, branch)) git(root, ["branch", "-D", branch]);
}

/** The name `finish` works on: `raw`, or the worktree `cwd` is in when `raw` is undefined. */
function finishName(root: string, raw: string | undefined, cwd: string): string {
  const name = raw === undefined ? worktreeOf(canonicalPath(path.resolve(cwd)), root, path) : requireName(raw);

  if (name === null || name === "")
    throw new WorktreeUsageError("run finish inside .worktrees/<name> or pass its name");

  return name;
}

/** Throw when the worktree cannot be rebased: mid-rebase, another branch out, or uncommitted changes. */
function checkReady(f: Finishing, entry: WorktreeEntry): void {
  const { dest, branch } = f;

  if (rebaseInProgress(dest)) {
    throw new Error(
      `${dest} is mid-rebase: finish it with git -C ${dest} rebase --continue (or --abort), then run finish again`,
    );
  }

  if (entry.branch !== branch) {
    throw new Error(
      `${dest} has ${entry.branch ?? "a detached HEAD"} checked out, not ${branch}: ` +
        `run git -C ${dest} switch ${branch}, then run finish again`,
    );
  }

  const dirty = git(dest, ["status", "--porcelain"]).out.split("\n").filter(Boolean).length;

  if (dirty > 0) {
    throw new Error(
      `${dest} has uncommitted changes in ${dirty} ${dirty === 1 ? "file" : "files"}: ` +
        "commit or drop them, then run finish again",
    );
  }
}

/** True when the branch has commits the default branch lacks. */
function isAhead(f: Finishing): boolean {
  const ahead = git(f.root, ["rev-list", "--count", `${f.target}..${f.branch}`]);

  if (!ahead.ok) throw new Error(`could not compare ${f.branch} with ${f.target}: ${gitReason(ahead.err)}`);

  return ahead.out !== NOTHING_AHEAD;
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

function shortSha(f: Finishing): string {
  return git(f.root, ["rev-parse", "--short", HEADS_REF + f.branch]).out;
}

/**
 * Land `wt/<name>` on the default branch and remove it: rebase inside the worktree, fast-forward the default branch,
 * remove worktree and branch. A rerun converges from any crash point. Never pushes.
 * `rootArg` is the main checkout; an undefined `raw` takes the name from the worktree `cwd` is in.
 */
export function finishWorktree(rootArg: string, raw: string | undefined, cwd: string = rootArg): FinishResult {
  const root = canonicalPath(rootArg);
  const name = finishName(root, raw, cwd);
  const [dest, branch] = [path.join(root, WORKTREES_DIR, name), BRANCH_PREFIX + name];
  const entry = liveEntry(root, dest);

  if (entry === undefined && !branchExists(root, branch))
    throw new Error(`no worktree or branch named ${name}: ${WORKTREE_CMD} list shows them`);
  const target = defaultBranch(root);

  if (target === NO_BRANCH)
    throw new Error(`${root} has no branch checked out and no origin/HEAD; check out the default branch there`);
  const f: Finishing = { branch, dest, root, target };

  if (entry !== undefined) checkReady(f, entry);
  const done = { branch: f.branch, defaultBranch: f.target, path: f.dest };

  if (!isAhead(f)) {
    const sha = hasOwnCommits(root, f.branch) ? shortSha(f) : null;
    retire(root, entry === undefined ? undefined : f.dest, f.branch);

    return { ...done, sha };
  }

  if (entry === undefined) {
    throw new Error(
      `${f.branch} has commits that ${f.target} lacks and no worktree: ` +
        `run ${WORKTREE_CMD} add ${name} to bring it back, then run finish again`,
    );
  }

  land(f);
  const sha = shortSha(f);
  retire(root, f.dest, f.branch);

  return { ...done, sha };
}

/** Remove clean managed worktrees whose commits reached the default branch, then merged `wt/*` branches left. */
export function pruneWorktrees(root: string): Pruned[] {
  const removed: Pruned[] = [];

  for (const w of listWorktrees(root)) {
    if (!w.managed || w.state !== "clean" || !w.merged || w.branch === null) continue;

    if (!git(root, ["worktree", "remove", w.path]).ok) continue;
    git(root, ["branch", "-D", w.branch]);
    removed.push({ branch: w.branch, path: w.path });
  }

  return [...removed, ...pruneBranches(root)];
}

/** Delete the merged `wt/*` branches no worktree holds; the ones deleted. */
function pruneBranches(root: string): Pruned[] {
  const held = new Set(worktreeEntries(root).map((e) => e.branch));
  const branches = git(root, ["for-each-ref", "--format=%(refname:short)", HEADS_REF + BRANCH_PREFIX]).out.split("\n");

  return branches
    .filter((b) => b !== "" && !held.has(b) && isMerged(root, b) && git(root, ["branch", "-D", b]).ok)
    .map((branch) => ({ branch, path: null }));
}
