export const DEFAULT_REFS: readonly string[] = ["main", "HEAD"];
export const SETTINGS = ".claude/settings.json";
/** A regular git file mode starts with this (100644, 100755); a symlink's 120000 and a submodule's 160000 do not. */
export const REGULAR_MODE = "100";
/** The most output of a git run read back, one gibibyte. */
/** The leading words of a git command that name it in an error, as `log nope`. */
export const GIT_ERROR_WORDS = 2;
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
export const FMT_ARGS: readonly string[] = ["fmt"];
export const REPO_BIN = "bin/repo.ts";
/** The arguments after the runtime and the script path. */
export const ARGV_START = 2;
