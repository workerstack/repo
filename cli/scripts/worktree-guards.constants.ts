import type path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import { IGNORED_DIRS, REPO } from "../repo-dirs.ts";
import type { WorkflowRead } from "../workflow.ts";
import { HEADS_REF, WORKTREE_CMD, WORKTREES_DIR } from "./worktree.constants.ts";
import type { Word } from "./worktree.types.ts";

/** Patterns the git guards match shell words and the user's message against. */
export const WT_BRANCH_PREFIX: RegExp = /^wt\//;
export const FORCE_OR_LONG_FORCE: RegExp = /^-[A-Za-z]*f[A-Za-z]*$|^--force/;
export const PLUS_REFSPEC: RegExp = /^\+./;
export const BRANCH_MOVE_FLAG: RegExp = /^-[A-Za-z]*[dDmM][A-Za-z]*$|^--(?:delete|move)$/;
export const BRANCH_FORCE_FLAG: RegExp = /^-[A-Za-z]*f[A-Za-z]*$|^--force$/;

/** A push word that sends every branch, the default one with them. */
const PUSH_EVERY_REF: RegExp = /^--(?:all|mirror)$/;

/** A word the user's message can name to grant one git command. */
export type GitGrant =
  | "am"
  | "branch"
  | "checkout"
  | "cherry-pick"
  | "clean"
  | "commit"
  | "force"
  | "merge"
  | "pull"
  | "rebase"
  | "reset"
  | "restore"
  | "revert"
  | "stash"
  | "switch"
  | "update-ref";

/** One grant per word the user's message can name; a bare word only where it has no everyday meaning here. */
export const GIT_ASKED: Readonly<Record<GitGrant, RegExp>> = {
  am: /\bgit\s+am\b/i,
  branch: /\bgit\s+branch\b/i,
  checkout: /\bgit\s+checkout\b/i,
  "cherry-pick": /\bcherry-pick\b/i,
  clean: /\bgit\s+clean\b/i,
  commit: /\bcommit\b/i,
  force: /\bforce[- ]push\b|\bpush\s+(?:-f|--force)\b/i,
  merge: /\bgit\s+merge\b/i,
  pull: /\bgit\s+pull\b/i,
  rebase: /\brebase\b/i,
  reset: /\bgit\s+reset\b/i,
  restore: /\bgit\s+restore\b/i,
  revert: /\bgit\s+revert\b/i,
  stash: /\bstash\b/i,
  switch: /\bgit\s+switch\b/i,
  "update-ref": /\bgit\s+update-ref\b/i,
};

/** Why a write into the main checkout of `root` is refused, naming where to write instead. */
export function mainCheckoutWriteText(root: string, p: typeof path): string {
  return (
    `the main checkout is shared: run ${WORKTREE_CMD} add <name> and write under ` +
    `${p.join(root, WORKTREES_DIR, "<name>")}; ` +
    `only ${p.join(root, REPO)}${p.sep}{${IGNORED_DIRS.join(",")}}${p.sep} is writable here`
  );
}

/** Why git `sub` moving the default `branch` is refused. */
export function defaultBranchReason(branch: string, sub: string): string {
  return (
    `${branch} is the shared default branch: move it only with ${WORKTREE_CMD} finish <name>, ` +
    `or when the user's message asks for git ${sub}`
  );
}

/**
 * Why git `sub` in the main checkout is refused: it risks uncommitted work when the workflow lets the main checkout
 * take writes, and other sessions' work when it does not.
 */
export function destroyText(sub: string, { mainWrites }: { mainWrites: boolean }): string {
  const what = mainWrites
    ? "uncommitted work: run it"
    : "other sessions' work: do it inside your worktree, or run it here";

  return `git ${sub} in the main checkout can destroy ${what} only when the user's message asks for git ${sub}`;
}

/** Why a force push is refused. */
export const FORCE_PUSH_REASON =
  "a force push rewrites shared history: run it only when the user's message asks for a force push";

/** `word` quoted so the push parser reads it back as one word: in double quotes when it holds a single quote. */
export function shellQuoted(word: string): string {
  return word.includes("'") ? `"${word}"` : `'${word}'`;
}

/** A push word that deletes the remote refs its other words name. */
const PUSH_DELETE_FLAG = /^(?:--delete|-d)$/;

/** A refspec with an empty source: `[+]:<dst>` deletes `<dst>` on the remote; group 1 is `<dst>`. */
const DELETE_REFSPEC = /^\+?:(.+)$/;

/**
 * Whether the words after `git push` reach `branch` in a form the ref resolver never reads: `--all` or `--mirror`,
 * a `:<branch>` or `+:<branch>` delete refspec, or `--delete`/`-d` with `<branch>`; bare or as `refs/heads/<branch>`.
 */
export function hitsUnresolved(rest: readonly Word[], branch: string): boolean {
  const names = new Set([branch, HEADS_REF + branch]);
  const words = rest.map((w) => w.text);

  if (words.some((w) => PUSH_EVERY_REF.test(w) || names.has(DELETE_REFSPEC.exec(w)?.[1] ?? ""))) return true;

  return words.some((w) => PUSH_DELETE_FLAG.test(w)) && words.some((w) => names.has(w));
}

/** Why `read` keeps the default branch for pull requests: the workflow it names, or a config that failed to load. */
function strictWhy(read: WorkflowRead): string {
  return read === "unreadable" ? `${CONFIG_FILE} failed to load` : `workflow is ${read}`;
}

/**
 * Why a push or a delete push of the default branch is refused under `read`, a workflow that keeps it for pull
 * requests, naming finish as the way to send work.
 */
export function defaultBranchPushReason(branch: string, read: WorkflowRead): string {
  return (
    `${branch} takes changes only through pull requests (${strictWhy(read)}): ` +
    `run ${WORKTREE_CMD} finish <name> to push wt/<name> and open its pull request`
  );
}

/**
 * Why a push with `word`, whose value the shell sets only as it runs (`$B` unset pushes the current branch), is
 * refused under `read`, a workflow that keeps the default branch for pull requests.
 */
export function unresolvedPushReason(word: string, branch: string, read: WorkflowRead): string {
  return (
    `git push names ${word}, which the gate cannot read before the shell runs, and ${branch} takes changes only ` +
    `through pull requests (${strictWhy(read)}): name the branch, such as git push origin wt/<name>, ` +
    `or run ${WORKTREE_CMD} finish <name>`
  );
}
