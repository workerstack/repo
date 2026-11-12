/** What `repo commit-msg --range` reads and prints. */

/** The `--range` flag. */
export const RANGE_FLAG = "--range";

/** A base that names no commit, as a push event of a new branch gives. */
export const ZERO_SHA = "0000000000000000000000000000000000000000";

/** The length of an abbreviated sha. */
export const SHORT_SHA = 7;

/** A full object name. */
export const FULL_SHA: RegExp = /^[0-9a-f]{40}$/;

/** How to call `repo commit-msg`, for the refusal when nothing is named. */
export const NAME_A_SOURCE =
  "repo commit-msg: name the commit message file as git's commit-msg hook does or pass --range <base>..<head>\n";

/** The arguments of `--range <base>..<head>`: the flag and the range. */
export const RANGE_ARGS = 2;

/** The sides of a range split on `..`. */
export const RANGE_SIDES = 2;
