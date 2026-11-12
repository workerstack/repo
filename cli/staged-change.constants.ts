/** The names `repo` reads from `git diff --numstat` and `git check-attr` output. */

/** The tokens `git check-attr -z` prints per path: the path, the attribute and its value. */
export const ATTR_TOKENS = 3;

/** Where the value sits in a `git check-attr -z` triple. */
export const ATTR_VALUE_AT = 2;

/** The two paths a numstat rename lists after its counts. */
export const RENAME_PATHS = 2;

/** The attribute values that mark a path as set. */
export const ATTR_SET = "set";
export const ATTR_TRUE = "true";
