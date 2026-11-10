/** The cargo call that lists a repo's crates, and the texts of what it finds. */

/** The cargo arguments: every package as JSON, resolved against the lock (`--no-deps` would not notice a stale lock). */
export const METADATA_ARGS: readonly string[] = ["metadata", "--format-version", "1", "--locked"];
/** The exit code cargo gives when `--locked` finds the lock needs an update. */
export const STALE_EXIT: number = 101;
/** The last words of every crate problem. */
export const PROBLEM_TAIL: string = "add them or set publish = false";
