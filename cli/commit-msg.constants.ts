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
/**
 * A `Key: value` body line, a trailer such as `Co-Authored-By:` or `Why:`; the BREAKING CHANGE footer is checked
 * first.
 */
export const KEY_VALUE: RegExp = /^[A-Za-z][\w-]*: \S/;
/** A `Breaking:` line, which belongs in a `BREAKING CHANGE:` footer. */
export const BREAKING_KEY: RegExp = /^Breaking:/i;
/** A line crediting a tool: the robot, the Anthropic noreply address, or a line starting "Generated with". */
export const ATTRIBUTION: RegExp = /🤖|noreply@anthropic\.com|^\s*generated with\b/iu;
/** The line `git revert` writes into the body. */
export const REVERT_LINE: RegExp = /^This reverts commit [0-9a-f]{7,40}\.$/;
/** The refusal of a free body under the size limit. */
export const FREE_BODY: string =
  "remove the body; keep the subject, plus at most a BREAKING CHANGE: footer, " +
  'a revert\'s "This reverts commit <sha>." line, or one line saying why when over the size limit';
/** The refusal of a why that runs past one line. */
export const ONE_WHY: string = "keep the why to one line";
