import { DECORATED_LINE, DECORATION, FIRST_LINE_END, LINE_BREAK, SLASHES } from "./comment-lines.constants.ts";

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The indent to remove from the continuation lines: their common minimum, capped at the first line's text column. */
function dedent(first: string, rest: readonly string[], column: number): number {
  const common = Math.min(...rest.filter((line) => line.trim() !== "").map(indentOf));

  return first.trim() === "" ? common : Math.min(common, column + SLASHES.length + indentOf(first));
}

/** The text of each line of a block comment: the star decoration removed, else the indent of `dedent`. */
function textLines(value: string, column: number): string[] {
  const lines = value.split(LINE_BREAK);
  const rest = lines.slice(1);
  const decorated = rest.every((line) => line.trim() === "" || DECORATED_LINE.test(line));
  const base = decorated ? 0 : dedent(value.slice(0, value.search(FIRST_LINE_END)), rest, column);

  function strip(line: string): string {
    return decorated ? line.replace(DECORATION, "") : line.slice(Math.min(base, indentOf(line)));
  }

  return lines.map((line, index) => (index === 0 ? line.trim() : strip(line).trimEnd()));
}

/** `lines` without its blank first and last entries. */
function trimmed(lines: readonly string[]): string[] {
  const from = lines.findIndex((line) => line !== "");

  if (from < 0) return [];
  // `findLastIndex` is ES2023, past the lib a consumer's tsconfig may give the shipped source.
  let to = lines.length;

  while (lines[to - 1] === "") to--;

  return lines.slice(from, to);
}

/**
 * The `//` lines (without indent) for a block comment whose text between `/*` and `*\/` is `value` and that starts at
 * `column`: a ` * ` or ` *` decoration goes from each continuation line when every non-blank one has it, else its
 * indent down to the least of the lines' common indent and the first line's text column (a deeper indent stays);
 * blank first and last lines are dropped and an empty line gives `//`.
 * The caller joins the lines with its own line break and indent.
 */
export function commentLines(value: string, column: number): string[] {
  const lines = trimmed(textLines(value, column)).map((line) => (line === "" ? SLASHES : `${SLASHES} ${line}`));

  return lines.length === 0 ? [SLASHES] : lines;
}
