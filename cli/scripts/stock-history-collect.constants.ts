export const DEFAULT_REFS: readonly string[] = ["main", "HEAD"];
export const SETTINGS = ".claude/settings.json";

/** The stock history table, relative to the root of this package's checkout. */
export const STOCK_HISTORY_REL = "cli/sync/stock-history.json";

/** A regular git file mode starts with this (100644, 100755); a symlink's 120000 and a submodule's 160000 do not. */
export const REGULAR_MODE = "100";

/** A symlink's git file mode. */
export const SYMLINK_MODE = "120000";

/** The leading words of a git command that name it in an error, as `log nope`. */
export const GIT_ERROR_WORDS = 2;

/** The most output of a git run read back, one gibibyte. */
export const GIT_MAX_BUFFER: number = 1024 * 1024 * 1024;

/** `git log --raw -z` prints a record, then the path, so the tokens come two to an entry. */
export const LOG_TOKENS_PER_ENTRY = 2;

export const LOG_ARGS: readonly string[] = [
  "-m",
  "--no-renames",
  "--diff-filter=AM",
  "--raw",
  "--no-abbrev",
  "-z",
  "--format=",
];

export const LS_FILES_ARGS: readonly string[] = ["ls-files", "-s", "-z"];
export const CAT_FILE_ARGS: readonly string[] = ["cat-file", "--batch"];
