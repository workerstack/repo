export const MESSAGE = "an own-line comment is written with //; run `bun repo lint --fix`";

/** A banner opened with an exclamation mark on the first line is a license header, which tools keep as a block. */
export const BANNER = "!";

/** A block comment opened with a second star is a doc. */
export const DOC = "*";

/** Config comments only the block form carries: global, exported and eslint settings. */
export const CONFIG: RegExp = /^\s*(?:globals?|exported|eslint)\s/;
export const CRLF = "\r\n";
export const LF = "\n";
