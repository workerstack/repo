import {
  BACKSLASH,
  BLOCK_CLOSE,
  BLOCK_OPEN,
  BYTE_PREFIX,
  COMMENT_MARK_LENGTH,
  DOUBLE_QUOTE,
  ESCAPE_LENGTH,
  HASH,
  HIGH_SURROGATE_MAX,
  HIGH_SURROGATE_MIN,
  PAIR_WIDTH,
  IDENT,
  LINE_COMMENT,
  NEWLINE,
  NUMBER,
  RAW_IDENT_OPEN,
  RAW_STRING_OPEN,
  SINGLE_QUOTE,
  SPACE,
  STRING_PREFIXES,
} from "./lexer.constants.ts";

/** What a token is; every character that is not a comment is code. */
type RustKind = "line-comment" | "block-comment" | "string" | "char" | "lifetime" | "punct" | "ident" | "other";

/** One token: its kind and its `[start, end)` range in the source's UTF-16 units. */
export type RustToken = { kind: RustKind; start: number; end: number };

/** The UTF-16 units of the character at `at`: two for an astral one, else one. */
function widthAt(source: string, at: number): number {
  const unit = source.charCodeAt(at);
  return unit >= HIGH_SURROGATE_MIN && unit <= HIGH_SURROGATE_MAX ? PAIR_WIDTH : 1;
}

/** The match of a sticky `pattern` at `at`, or null. */
function matchAt(pattern: RegExp, source: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at;
  return pattern.exec(source);
}

/** The end of a block comment opened at `at`, counting nested ones; an open one runs to the end. */
function blockEnd(source: string, at: number): number {
  let depth = 1;
  let index = at + COMMENT_MARK_LENGTH;
  while (index < source.length && depth > 0) {
    if (source.startsWith(BLOCK_OPEN, index)) {
      depth += 1;
    } else if (source.startsWith(BLOCK_CLOSE, index)) {
      depth -= 1;
    } else {
      index += 1;
      continue;
    }
    index += COMMENT_MARK_LENGTH;
  }
  return index;
}

/** The end of the quoted text whose quote is at `at`; backslash escapes the next character. */
function quotedEnd(source: string, at: number, quote: string): number {
  let index = at + 1;
  while (index < source.length) {
    if (source[index] === quote) return index + 1;
    index += source[index] === BACKSLASH ? ESCAPE_LENGTH : 1;
  }
  return source.length;
}

/** The end of a raw string whose body starts at `from` and closes on a quote and `hashes` hashes. */
function rawEnd(source: string, from: number, hashes: number): number {
  const close = DOUBLE_QUOTE + HASH.repeat(hashes);
  const found = source.indexOf(close, from);
  return found < 0 ? source.length : found + close.length;
}

/** The token for a quote at `at`: a char or a lifetime, or a lone quote. */
function quoteToken(source: string, at: number): RustToken {
  if (at + 1 >= source.length) return { end: at + 1, kind: "punct", start: at };
  const width = widthAt(source, at + 1);
  if (source[at + 1] === BACKSLASH || source[at + 1 + width] === SINGLE_QUOTE)
    return { end: quotedEnd(source, at, SINGLE_QUOTE), kind: "char", start: at };
  const ident = matchAt(IDENT, source, at + 1);
  if (ident === null) return { end: at + 1, kind: "punct", start: at };
  return { end: at + 1 + ident[0].length, kind: "lifetime", start: at };
}

/** The token for `word`, the identifier matched at `at`: a raw, byte or c string, a byte char, a raw identifier or an identifier. */
function wordToken(source: string, at: number, word: string): RustToken {
  const raw = matchAt(RAW_STRING_OPEN, source, at);
  if (raw !== null)
    return { end: rawEnd(source, at + raw[0].length, raw[0].split(HASH).length - 1), kind: "string", start: at };
  const next = source[at + 1];
  if (word.length === 1 && STRING_PREFIXES.includes(word) && next === DOUBLE_QUOTE)
    return { end: quotedEnd(source, at + 1, DOUBLE_QUOTE), kind: "string", start: at };
  if (word === BYTE_PREFIX && next === SINGLE_QUOTE)
    return { end: quotedEnd(source, at + 1, SINGLE_QUOTE), kind: "char", start: at };
  const rawIdent = source.startsWith(RAW_IDENT_OPEN, at) ? matchAt(IDENT, source, at + RAW_IDENT_OPEN.length) : null;
  const end = rawIdent === null ? at + word.length : at + RAW_IDENT_OPEN.length + rawIdent[0].length;
  return { end, kind: "ident", start: at };
}

/** The token starting at `at`, which is not whitespace. */
function tokenAt(source: string, at: number): RustToken {
  if (source.startsWith(LINE_COMMENT, at)) {
    const newline = source.indexOf(NEWLINE, at);
    return { end: newline < 0 ? source.length : newline, kind: "line-comment", start: at };
  }
  if (source.startsWith(BLOCK_OPEN, at)) return { end: blockEnd(source, at), kind: "block-comment", start: at };
  if (source[at] === DOUBLE_QUOTE) return { end: quotedEnd(source, at, DOUBLE_QUOTE), kind: "string", start: at };
  if (source[at] === SINGLE_QUOTE) return quoteToken(source, at);
  const word = matchAt(IDENT, source, at);
  if (word !== null) return wordToken(source, at, word[0]);
  const number = matchAt(NUMBER, source, at);
  if (number !== null) return { end: at + number[0].length, kind: "other", start: at };
  return { end: at + widthAt(source, at), kind: "punct", start: at };
}

/**
 * Splits Rust source into tokens, whitespace dropped. It knows nested block comments, raw, byte and c strings,
 * escapes, and a char from a lifetime, so a `/*` or an attribute inside a string is never mistaken for code.
 * Text that never closes runs to the end of the file.
 */
export function lexRust(source: string): RustToken[] {
  const tokens: RustToken[] = [];
  let at = 0;
  while (at < source.length) {
    if (SPACE.test(source.charAt(at))) {
      at += 1;
      continue;
    }
    const token = tokenAt(source, at);
    tokens.push(token);
    at = token.end;
  }
  return tokens;
}
