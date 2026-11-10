/** A dir of this name holds test inputs, which the conversion leaves as written (oxlint ignores it too). */
export const FIXTURES_DIR = "fixtures";
/** What opens and closes a block comment, and what opens a doc comment and a license comment. */
export const BLOCK_OPEN = "/*";
export const BLOCK_CLOSE = "*/";
export const DOC_OPEN = "/**";
export const LICENSE_OPEN = "/*!";
/** What follows the file name in the `--check` message. */
export const OWN_LINE_MESSAGE = "has an own-line /* */ comment at line";
/** jsonc-parser's scanner token kinds (its `SyntaxKind` is a const enum, which an isolated build cannot read). */
export const BLOCK_COMMENT_TOKEN = 13;
export const EOF_TOKEN = 17;
