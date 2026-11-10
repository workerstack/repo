/** `git grep` naming each tracked text file that holds a fixed string, NUL after each name. */
export const GREP_ARGS: readonly string[] = ["grep", "-l", "-z", "-I", "-F"];
/** What separates the names `GREP_ARGS` prints. */
export const NUL = "\0";
/** A path segment whose files are test data: a copy of one of ours there is never pruned. */
export const FIXTURES_SEGMENT = "fixtures";
