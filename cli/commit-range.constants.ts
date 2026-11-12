/** What `repo commit-msg --range` and `--pre-push` read and print. */

/** The `--range` flag. */
export const RANGE_FLAG = "--range";

/** The `--pre-push` flag. */
export const PRE_PUSH_FLAG = "--pre-push";

/** The fewest arguments of `--pre-push <remote> [<url>]`: the flag and the remote. */
export const PRE_PUSH_MIN_ARGS = 2;

/** The most arguments of `--pre-push <remote> [<url>]`: the flag and the two git passes the hook. */
export const PRE_PUSH_MAX_ARGS = 3;

/** An object name git gives a pre-push hook: SHA-1 or SHA-256 hex. */
export const OBJECT_NAME: RegExp = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** An all-zero object name, which a pre-push line gives for a ref that does not exist on that side. */
export const NO_OBJECT: RegExp = /^0+$/;

/** The gap between the fields of a pre-push ref line. */
export const FIELD_GAP: RegExp = /\s+/;

/** The fields of a pre-push ref line: `<local ref> <local sha> <remote ref> <remote sha>`. */
export const REF_LINE_FIELDS = 4;

/** A base that names no commit, as a push event of a new branch gives. */
export const ZERO_SHA = "0000000000000000000000000000000000000000";

/** The length of an abbreviated sha. */
export const SHORT_SHA = 7;

/** A full object name. */
export const FULL_SHA: RegExp = /^[0-9a-f]{40}$/;

/** How to call `repo commit-msg`, for the refusal when nothing is named. */
export const NAME_A_SOURCE: string =
  "repo commit-msg: name the commit message file as git's commit-msg hook does, or pass --range <base>..<head> or " +
  "--pre-push\n";

/** The arguments of `--range <base>..<head>`: the flag and the range. */
export const RANGE_ARGS = 2;

/** The sides of a range split on `..`. */
export const RANGE_SIDES = 2;
