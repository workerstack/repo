/** The tag whose text must name what replaces the thing: it starts a line of the block, as a JSDoc tag does. */
export const DEPRECATED: RegExp = /^[ \t*]*@deprecated\b/m;

/** What the tag's text must hold: a `{@link name}` or "use `name`" (also "replaced by", "moved to"). */
export const REPLACEMENT: RegExp = /\{@link\s+[^}\s][^}]*\}|\b(?:use|replaced by|moved to)\s+`[^`]+`/i;

/** The next tag line of a JSDoc block, where the deprecation text ends. */
export const NEXT_TAG: RegExp = /\n\s*\*?\s*@\w/;

/** The report for a `@deprecated` tag that names no replacement. */
export const MESSAGE = '`@deprecated` names no replacement: write "use `newName` instead" or {@link newName}';
