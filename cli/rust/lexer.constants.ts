/** The Rust lexer's fixed text. */

/** Opens a line comment. */
export const LINE_COMMENT: string = "//";
/** Opens a block comment. */
export const BLOCK_OPEN: string = "/*";
/** Closes a block comment. */
export const BLOCK_CLOSE: string = "*/";
/** What a line comment runs up to. */
export const NEWLINE: string = "\n";
/** Quotes a string. */
export const DOUBLE_QUOTE: string = '"';
/** Quotes a char, and opens a lifetime. */
export const SINGLE_QUOTE: string = "'";
/** Escapes the character after it in a string or a char. */
export const BACKSLASH: string = "\\";
/** Opens a raw identifier, as in `r#type`. */
export const RAW_IDENT_OPEN: string = "r#";
/** Closes a raw string once the hashes follow. */
export const HASH: string = "#";
/** The prefixes that make a string a byte string or a c string. */
export const STRING_PREFIXES: string = "bc";
/** The prefix of a byte char. */
export const BYTE_PREFIX: string = "b";
/** How many characters an escape covers: the backslash and the one it escapes. */
export const ESCAPE_LENGTH: number = 2;
/** The length of a comment opener or closer. */
export const COMMENT_MARK_LENGTH: number = 2;
/** The first UTF-16 unit of a surrogate pair. */
export const HIGH_SURROGATE_MIN: number = 0xd8_00;
/** The last UTF-16 unit that starts a surrogate pair. */
export const HIGH_SURROGATE_MAX: number = 0xdb_ff;
/** How many UTF-16 units a character outside the basic plane takes. */
export const PAIR_WIDTH: number = 2;
/** An identifier: a letter or underscore, then letters, digits and underscores. */
export const IDENT: RegExp = /[\p{L}_][\p{L}\p{N}_]*/uy;
/** A number's start; suffixes and radix letters ride along. */
export const NUMBER: RegExp = /\d[\p{L}\p{N}_]*/uy;
/** A raw string's opener, capturing its hashes: `r#"`, `br"`, `cr##"`. */
export const RAW_STRING_OPEN: RegExp = /[bc]?r(#*)"/y;
/** Whitespace between tokens. */
export const SPACE: RegExp = /\s/u;
