/** The steps a local finish and a pull-request finish share: the ready check, the ahead check and the clean-up. */
import fs from "node:fs";
import path from "node:path";

import { removeTree } from "../remove-tree.ts";
import { canonicalPath } from "./workspace-root.ts";
import {
  dropRemoteBranch,
  git,
  gitReason,
  hasOwnCommits,
  isCheckedOut,
  isMerged,
  rebaseInProgress,
} from "./worktree-git.ts";
import { syncRoot } from "./worktree-setup.ts";
import { HEADS_REF, NOTHING_AHEAD, WORKTREE_CMD } from "./worktree.constants.ts";
import type { Finishing, LocalFinish, WorktreeEntry } from "./worktree.types.ts";

/**
 * Remove the worktree dir (never forced), or only unregister it when another session's prune got there first. On win32
 * `git worktree remove` exits 0 but leaves the directory links sync made (`.agents/skills/*`, `.claude/skills/*`)
 * and their parents, so what git left after it judged the tree clean is removed without following any link.
 */
export function removeWorktreeDir(root: string, worktree: string): void {
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
  removeTree(worktree);
}

/** Delete `branch`: origin's copy first, so a crash between leaves the local one. */
export function dropBranch(root: string, branch: string): boolean {
  dropRemoteBranch(root, branch);

  return git(root, ["branch", "-D", branch]).ok;
}

/** Remove the worktree, if any, then delete the branch once the default branch holds it. */
export function retire(root: string, worktree: string | undefined, branch: string): void {
  if (worktree !== undefined) removeWorktreeDir(root, worktree);

  if (isMerged(root, branch)) dropBranch(root, branch);
}

/** Throw when the worktree cannot be rebased: mid-rebase, another branch out, or uncommitted changes. */
export function checkReady(f: Finishing, entry: WorktreeEntry): void {
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

/** True when the branch has commits `f.target` lacks. */
export function isAhead(f: Finishing): boolean {
  const ahead = git(f.root, ["rev-list", "--count", `${f.target}..${f.branch}`]);

  if (!ahead.ok) throw new Error(`could not compare ${f.branch} with ${f.target}: ${gitReason(ahead.err)}`);

  return ahead.out !== NOTHING_AHEAD;
}

/** The short sha of `branch`'s tip in the root. */
export function shortTip(root: string, branch: string): string {
  return git(root, ["rev-parse", "--short", HEADS_REF + branch]).out;
}

/** What every finish of `f` reports: the branch, the worktree dir and the default branch. */
export function finished(f: Finishing): Omit<LocalFinish, "sha"> {
  return { branch: f.branch, defaultBranch: f.target, path: f.dest };
}

/** Retire a branch with nothing to land: remove its worktree, if any, and the branch once merged. */
export function retired(f: Finishing, entry: WorktreeEntry | undefined): LocalFinish {
  const sha = hasOwnCommits(f.root, f.branch) ? shortTip(f.root, f.branch) : null;
  retire(f.root, entry === undefined ? undefined : f.dest, f.branch);

  return { ...finished(f), sha };
}

/** Why a branch with commits to land cannot finish: it has no worktree to rebase in. */
export function noWorktree(f: Finishing): Error {
  return new Error(
    `${f.branch} has commits that ${f.target} lacks and no worktree: ` +
      `run ${WORKTREE_CMD} add ${path.basename(f.dest)} to bring it back, then run finish again`,
  );
}

/** Why finish has nothing to work on. */
export function nothingNamed(name: string): Error {
  return new Error(`no worktree or branch named ${name}: ${WORKTREE_CMD} list shows them`);
}

/** Run `bun repo sync` in the root when it has the default branch out. */
export function syncIfOut(root: string, target: string): void {
  if (isCheckedOut(root, target)) syncRoot(root);
}
