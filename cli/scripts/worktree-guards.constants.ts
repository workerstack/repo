/** Patterns the git guards match shell words and the user's message against. */
export const WT_BRANCH_PREFIX: RegExp = /^wt\//;
export const FORCE_OR_LONG_FORCE: RegExp = /^-[A-Za-z]*f[A-Za-z]*$|^--force/;
export const PLUS_REFSPEC: RegExp = /^\+./;
export const BRANCH_MOVE_FLAG: RegExp = /^-[A-Za-z]*[dDmM][A-Za-z]*$|^--(?:delete|move)$/;
export const BRANCH_FORCE_FLAG: RegExp = /^-[A-Za-z]*f[A-Za-z]*$|^--force$/;

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
