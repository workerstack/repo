import { eastAsianWidth } from "get-east-asian-width";

import { asNode, isSyntaxList, isSyntaxString, type SyntaxValue } from "../syntax-node.ts";
import {
  ASCII_TEXT,
  CALL_EXPRESSION,
  CODE_HINT,
  COMMENT_HINT,
  EMOJI,
  EMOJI_WIDTH,
  IDENTIFIER,
  LITERAL,
  PARENT_KEY,
  PRINT_WIDTH,
  REGEX_HINT,
  SEALED_CALLEE,
  STRING_HINT,
  TEMPLATE_ELEMENT,
  TRAILING_CR,
  URL_TEXT,
  ZERO_WIDTH,
} from "./max-line-width.constants.ts";
import type { RepoRule, RuleComment } from "./rule.types.ts";

type Range = { start: number; end: number; hint: string };

/** A source span whose columns a line's width leaves out. */
type Span = { start: number; end: number };

type Found = {
  type: string;
  range: readonly [number, number];
  regex?: unknown;
  value?: SyntaxValue;
  name?: unknown;
  callee?: Found;
  arguments?: readonly Found[];
};

/** What `gather` collects: hinted ranges, and the cipher literals of `sealed(…)` calls that take no columns. */
type Gathered = { ranges: Range[]; exempt: Span[] };

/** A line's text without its exempt spans, and where each kept part starts in the line. */
type Kept = { text: string; parts: readonly { from: number; at: number }[] };

type Piece = { at: number; width: number };

/** The columns one grapheme takes the way bun fmt counts: an emoji 2, marks 0, wide and fullwidth 2, the rest 1. */
function graphemeWidth(grapheme: string): number {
  if (EMOJI.test(grapheme)) return EMOJI_WIDTH;
  let width = 0;

  for (const char of grapheme) {
    const point = char.codePointAt(0) /* a char of a string has a code point */ as number;

    if (!ZERO_WIDTH.test(char)) width += eastAsianWidth(point);
  }

  return width;
}

/** Splits `text` into its graphemes with the offset each starts at and the columns it takes. */
function piecesOf(text: string): Piece[] {
  const segmenter = new Intl.Segmenter();

  return Array.from(segmenter.segment(text), ({ index, segment }) => ({ at: index, width: graphemeWidth(segment) }));
}

function widthOf(text: string): number {
  return piecesOf(text).reduce((sum, piece) => sum + piece.width, 0);
}

/** The hint for a node that holds text bun fmt leaves long, or none. */
function hintOf(node: Found): string | undefined {
  if (node.type === TEMPLATE_ELEMENT) return STRING_HINT;

  if (node.type !== LITERAL) return undefined;

  if (node.regex !== undefined) return REGEX_HINT;

  return isSyntaxString(node.value) ? STRING_HINT : undefined;
}

/** The range of the cipher a `sealed("…")` call takes as its one string argument, or none for any other node. */
function cipherOf(node: Found): Span | undefined {
  if (node.type !== CALL_EXPRESSION || node.callee?.type !== IDENTIFIER || node.callee.name !== SEALED_CALLEE)
    return undefined;

  const [argument, ...rest] = [node.arguments].flat();

  if (argument?.type !== LITERAL || !isSyntaxString(argument.value) || rest.length > 0) return undefined;

  return { end: argument.range[1], start: argument.range[0] };
}

/** Notes the sealed cipher `ast` is, or else the hinted range it holds that no cipher already exempts. */
function note(ast: Found, found: Gathered): void {
  const cipher = cipherOf(ast);
  const hint = hintOf(ast);

  if (cipher !== undefined) found.exempt.push(cipher);
  else if (hint !== undefined && !found.exempt.some((span) => span.start === ast.range[0]))
    found.ranges.push({ end: ast.range[1], hint, start: ast.range[0] });
}

/** Every string, template and regex range under `node`, and every sealed cipher, found without the `parent` links. */
function gather(value: SyntaxValue, found: Gathered): void {
  if (isSyntaxList(value)) {
    for (const item of value) gather(item, found);

    return;
  }

  const node = asNode(value);

  if (node === null || node instanceof RegExp) return;

  if ("type" in node && "range" in node)
    note(node /* an object with a type and a range is an AST node */ as Found, found);

  for (const [key, child] of Object.entries(node)) if (key !== PARENT_KEY) gather(child, found);
}

/** `line`, which starts at source offset `lineStart`, with the parts `exempt` covers taken out. */
function keptOf(line: string, lineStart: number, exempt: readonly Span[]): Kept {
  const skipped = new Set<number>();

  for (const span of exempt) {
    for (let at = Math.max(0, span.start - lineStart); at < Math.min(line.length, span.end - lineStart); at++)
      skipped.add(at);
  }

  const parts: { from: number; at: number }[] = [];
  let text = "";

  for (let from = 0; from < line.length; from++) {
    if (skipped.has(from)) continue;

    if (from === 0 || skipped.has(from - 1)) parts.push({ at: text.length, from });
    text += line.charAt(from);
  }

  return { parts, text };
}

/** The offset in the line of `offset` in its kept text. */
function lineOffset(kept: Kept, offset: number): number {
  let part = { at: 0, from: 0 };

  for (const candidate of kept.parts) if (candidate.at <= offset) part = candidate;

  return part.from + offset - part.at;
}

/** The hint of the string, comment or regex that covers most of the line from `start` to `end`, else the code hint. */
function hintAt(ranges: readonly Range[], start: number, end: number): string {
  let best = { covered: 0, hint: CODE_HINT };

  for (const range of ranges) {
    const covered = Math.min(end, range.end) - Math.max(start, range.start);

    if (covered > best.covered) best = { covered, hint: range.hint };
  }

  return best.hint;
}

/** The code-unit offset of the grapheme that column 121 begins in, or none when the line fits. */
function overflowAt(line: string): number | undefined {
  let used = 0;

  for (const piece of piecesOf(line)) {
    if (used + piece.width > PRINT_WIDTH) return piece.at;
    used += piece.width;
  }

  return undefined;
}

/** The hinted ranges and sealed ciphers of `program`, its comments among the ranges. */
function gathered(program: SyntaxValue, comments: readonly RuleComment[]): Gathered {
  const found: Gathered = { exempt: [], ranges: [] };
  gather(program, found);

  for (const comment of comments)
    found.ranges.push({ end: comment.range[1], hint: COMMENT_HINT, start: comment.range[0] });

  return found;
}

/** Whether `line` fits for sure without counting graphemes: ASCII only, one column a character, short enough. */
function plainlyFits(line: string): boolean {
  return line.length <= PRINT_WIDTH && ASCII_TEXT.test(line);
}

/** One source line: its text without the carriage return, its 0-based index and the source offset it starts at. */
type Line = { text: string; index: number; start: number };

/** The report of `line` when it is wider than `PRINT_WIDTH` past its exempt spans and URLs, or null. */
function wideReport({ text, index, start }: Line, { exempt, ranges }: Gathered) {
  const kept = keptOf(text, start, exempt);
  const overflow = overflowAt(kept.text);

  if (overflow === undefined || widthOf(kept.text.replaceAll(URL_TEXT, "")) <= PRINT_WIDTH) return null;
  const column = lineOffset(kept, overflow);

  return {
    data: { hint: hintAt(ranges, start, start + text.length), width: String(widthOf(kept.text)) },
    loc: { end: { column: text.length, line: index + 1 }, start: { column, line: index + 1 } },
    messageId: "wide" as const,
  };
}

/**
 * Fails each line wider than `PRINT_WIDTH` columns as bun fmt counts them, reported at column 121. Exempt spans only
 * take columns away, so a line that fits whole is passed before the program is walked for them, and a file with no
 * wide line is never walked.
 */
export const maxLineWidth: RepoRule<"wide"> = {
  create(context) {
    return {
      Program(program) {
        const { sourceCode } = context;
        let found: Gathered | null = null;
        let start = 0;

        for (const [index, raw] of sourceCode.text.split("\n").entries()) {
          const text = raw.replace(TRAILING_CR, "");

          if (!plainlyFits(text) && overflowAt(text) !== undefined) {
            found ??= gathered(asNode(program), sourceCode.getAllComments());
            const report = wideReport({ index, start, text }, found);

            if (report !== null) context.report(report);
          }

          start += raw.length + 1;
        }
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { wide: `this line is {{width}} columns, over ${PRINT_WIDTH}; {{hint}}` },
    schema: [],
    type: "layout",
  },
};
