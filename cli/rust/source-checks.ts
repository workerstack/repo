import { lexRust, type RustToken } from "./lexer.ts";
import {
  ATTRIBUTE_ADVICE,
  ATTRIBUTE_RULE,
  ATTRIBUTE_START,
  BLOCK_COMMENT_MESSAGE,
  BLOCK_COMMENT_RULE,
  CFG_ATTR,
  AFTER_NAME,
  CLOSE_BRACKET,
  INNER_SKIP,
  INNER_MARK,
  LINT_LEVELS,
  MAX_CODE_LINES,
  MAX_LINES_RULE,
  OPEN_BRACKET,
  OPEN_PAREN,
} from "./source-checks.constants.ts";

/** The rules a Rust hit names: the three source rules, and the lints clippy and rustc report. */
export type RustRule =
  | "repo/rust-lint-attribute"
  | "repo/rust-block-comment"
  | "repo/rust-max-lines"
  | `clippy/${string}`
  | `rust/${string}`;

/** One finding: a 1-based `line` and `column` (in characters) in `file`. */
export type RustHit = { file: string; line: number; column: number; rule: RustRule; message: string };

/** The 1-based line and column of each offset in one source. */
type Locate = (offset: number) => { line: number; column: number };

/** A `Locate` for `source`, by binary search over its line starts. */
function locator(source: string): Locate {
  const starts = [0];
  let at = source.indexOf("\n");
  while (at >= 0) {
    starts.push(at + 1);
    at = source.indexOf("\n", at + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] /* middle lies between low and high, inside starts */ as number) <= offset) low = middle;
      else high = middle - 1;
    }
    return { column: Array.from(source.slice(starts[low], offset)).length + 1, line: low + 1 };
  };
}

/** What the attribute scan reads: the code tokens (no comments) of one source and their text. */
type Scan = { code: RustToken[]; source: string };

/** The text of the token at `index`, or an empty string past the end. */
function wordAt(scan: Scan, index: number): string {
  const token = scan.code[index];
  return token ? scan.source.slice(token.start, token.end) : "";
}

/** The lint level a `cfg_attr` applies, whose brackets open at `open`, or null. */
function cfgAttrLevel(scan: Scan, open: number): string | null {
  let depth = 1;
  for (let index = open + AFTER_NAME; index < scan.code.length && depth > 0; index += 1) {
    const word = wordAt(scan, index);
    if (word === OPEN_BRACKET) depth += 1;
    else if (word === CLOSE_BRACKET) depth -= 1;
    else if (LINT_LEVELS.includes(word) && wordAt(scan, index + 1) === OPEN_PAREN) return word;
  }
  return null;
}

/** The attribute that starts at `index` as the message names it (`#[allow]`), or null when it sets no lint level. */
function attributeAt(scan: Scan, index: number): string | null {
  const inner = wordAt(scan, index + 1) === INNER_MARK;
  const open = index + (inner ? INNER_SKIP : 1);
  if (wordAt(scan, open) !== OPEN_BRACKET) return null;
  const name = wordAt(scan, open + 1);
  const level = name === CFG_ATTR ? cfgAttrLevel(scan, open) : name;
  if (level === null || !LINT_LEVELS.includes(level)) return null;
  const written = name === CFG_ATTR ? `${CFG_ATTR}(… ${level})` : level;
  return `#${inner ? INNER_MARK : ""}${OPEN_BRACKET}${written}${CLOSE_BRACKET}`;
}

/** The attribute hits among the `code` tokens, which hold no comments. */
function attributeHits(file: string, scan: Scan, locate: Locate): RustHit[] {
  const hits: RustHit[] = [];
  for (const [index, token] of scan.code.entries()) {
    if (token.kind !== "punct" || wordAt(scan, index) !== ATTRIBUTE_START) continue;
    const attribute = attributeAt(scan, index);
    if (attribute === null) continue;
    hits.push({ file, ...locate(token.start), rule: ATTRIBUTE_RULE, message: `${attribute} ${ATTRIBUTE_ADVICE}` });
  }
  return hits;
}

/** The hit for a file with more than the limit of code lines, at its first line past the limit. */
function lineHits(file: string, code: RustToken[], locate: Locate): RustHit[] {
  const lines = new Set<number>();
  for (const token of code) {
    const last = locate(Math.max(token.start, token.end - 1)).line;
    for (let line = locate(token.start).line; line <= last; line += 1) lines.add(line);
  }
  if (lines.size <= MAX_CODE_LINES) return [];
  const over = [...lines].reduce((found, line, index) => (index === MAX_CODE_LINES ? line : found), 0);
  const message = `this file has ${lines.size} code lines over ${MAX_CODE_LINES}; split it into modules`;
  return [{ column: 1, file, line: over, message, rule: MAX_LINES_RULE }];
}

/**
 * The hits the three Rust source rules find in `source`, read as `rel`: a lint-level attribute, a block
 * comment, and a file with more than 200 lines holding code. Ordered by position.
 */
export function rustSourceHits(rel: string, source: string): RustHit[] {
  const tokens = lexRust(source);
  const locate = locator(source);
  const code = tokens.filter((token) => token.kind !== "line-comment" && token.kind !== "block-comment");
  const comments = tokens
    .filter((token) => token.kind === "block-comment")
    .map((token): RustHit => ({
      file: rel,
      ...locate(token.start),
      rule: BLOCK_COMMENT_RULE,
      message: BLOCK_COMMENT_MESSAGE,
    }));
  return [...attributeHits(rel, { code, source }, locate), ...comments, ...lineHits(rel, code, locate)].sort(
    (a, b) => a.line - b.line || a.column - b.column,
  );
}
