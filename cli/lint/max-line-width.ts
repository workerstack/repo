import type { CreateRule } from "@oxlint/plugins";
import { eastAsianWidth } from "get-east-asian-width";

import {
  CODE_HINT,
  COMMENT_HINT,
  EMOJI,
  EMOJI_WIDTH,
  LITERAL,
  PARENT_KEY,
  PRINT_WIDTH,
  REGEX_HINT,
  STRING_HINT,
  TEMPLATE_ELEMENT,
  TRAILING_CR,
  URL_TEXT,
  ZERO_WIDTH,
} from "./max-line-width.constants.ts";

type Range = { start: number; end: number; hint: string };
type Ranged = { start: number; end: number };
type Found = Ranged & { type: string; regex?: unknown; value?: unknown };
type Piece = { at: number; width: number };

/** The columns one grapheme takes the way oxfmt counts: an emoji 2, marks 0, wide and fullwidth 2, the rest 1. */
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

const widthOf = (text: string): number => piecesOf(text).reduce((sum, piece) => sum + piece.width, 0);

/** The hint for a node that holds text oxfmt leaves long, or none. */
function hintOf(node: Found): string | undefined {
  if (node.type === TEMPLATE_ELEMENT) return STRING_HINT;
  if (node.type !== LITERAL) return undefined;
  if (node.regex !== undefined) return REGEX_HINT;
  return typeof node.value === "string" ? STRING_HINT : undefined;
}

/** Every string, template and regex range under `node`, found without the `parent` links. */
function gather(node: unknown, ranges: Range[]): void {
  if (typeof node !== "object" || node === null) return;
  if ("type" in node && "start" in node && "end" in node) {
    const found = node /* an object with a type and a range is an AST node */ as Found;
    const hint = hintOf(found);
    if (hint !== undefined) ranges.push({ end: found.end, hint, start: found.start });
  }
  for (const [key, value] of Object.entries(node)) if (key !== PARENT_KEY) gather(value, ranges);
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

/** Fails each line wider than `PRINT_WIDTH` columns as oxfmt counts them, reported at column 121. */
export const maxLineWidth: CreateRule = {
  create(context) {
    return {
      Program(program: Ranged) {
        const ranges: Range[] = [];
        gather(program, ranges);
        for (const comment of context.sourceCode.getAllComments())
          ranges.push({ end: comment.end, hint: COMMENT_HINT, start: comment.start });

        let lineStart = 0;
        for (const [index, raw] of context.sourceCode.text.split("\n").entries()) {
          const line = raw.replace(TRAILING_CR, "");
          const column = overflowAt(line);
          if (column !== undefined && widthOf(line.replaceAll(URL_TEXT, "")) > PRINT_WIDTH) {
            const width = widthOf(line);
            const hint = hintAt(ranges, lineStart, lineStart + line.length);
            context.report({
              loc: { end: { column: line.length, line: index + 1 }, start: { column, line: index + 1 } },
              message: `this line is ${width} columns, over ${PRINT_WIDTH}; ${hint}`,
            });
          }
          lineStart += raw.length + 1;
        }
      },
    };
  },
};
