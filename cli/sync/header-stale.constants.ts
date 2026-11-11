/** `git grep` naming each tracked text file that holds a fixed string, NUL after each name. */
export const GREP_ARGS: readonly string[] = ["grep", "-l", "-z", "-I", "-F"];
/** What separates the names `GREP_ARGS` prints. */
export const NUL = "\0";
