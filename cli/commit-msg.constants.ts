/** The commit types that must carry a test change, and that red-proof holds. */
export const NEEDS_TEST: readonly string[] = ["feat", "fix"];
/** What `indexOf` returns for an item it does not find. */
export const NOT_FOUND: number = -1;
/** The index `Array#at` reads the last item from. */
export const LAST: number = -1;
/** A kebab-case scope: lowercase words and digits joined by single hyphens. */
export const KEBAB_SCOPE: RegExp = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** A subject that starts with an uppercase letter. */
export const CAPITAL_START: RegExp = /^[A-Z]/;
