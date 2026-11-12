/** jsonc-parser's scanner token kinds (its `SyntaxKind` is a const enum, which an isolated build cannot read). */
export const COMMA_TOKEN = 5;
export const LINE_COMMENT_TOKEN = 12;
export const BLOCK_COMMENT_TOKEN = 13;
export const LINE_BREAK_TOKEN = 14;
export const SPACE_TOKEN = 15;
export const EOF_TOKEN = 17;

/** jsonc-parser's node types that hold others. */
export const OBJECT_NODE = "object";
export const ARRAY_NODE = "array";

/** The line endings a file is written with. */
export const CRLF = "\r\n";
export const LF = "\n";

/** Where a key's path puts the next key. */
export const PATH_SEPARATOR = ".";
