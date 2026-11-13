export const ARGV_START = 2;

export const CHECK_FLAG = "--check";
export const TREE_FLAG = "--tree";

export const DEFAULT_PATHS: readonly string[] = [
  "cli",
  "bin",
  "dev",
  "e2e",
  "agents",
  "references",
  "README.md",
  "AGENTS.md",
];

export const SKIPPED: readonly string[] = ["node_modules", "CHANGELOG.md", ".git", ".worktrees"];

/** The codemod and its test spell the old path on purpose; `--check` skips them. */
export const SELF: readonly string[] = ["dev/move-tmp-paths.ts", "dev/move-tmp-paths.test.ts"];
export const RED_PROOF = "red-proof-";
