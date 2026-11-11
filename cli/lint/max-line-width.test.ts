import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { PRINT_WIDTH } from "./max-line-width.constants.ts";
import { maxLineWidth } from "./max-line-width.ts";

function messagesOf(code: string) {
  return reportsOf(maxLineWidth, { "a.ts": code }).map((report) => report.message);
}
/** The message for a line `extra` columns past the width. */
function over(extra: number, hint: string) {
  return `this line is ${PRINT_WIDTH + extra} columns, over ${PRINT_WIDTH}; ${hint}`;
}
const STRING_HINT = "split the string with + or a join";
const COMMENT_HINT = "wrap the comment onto more lines";
const REGEX_HINT = "build the regex from named parts";
const CODE_HINT = "extract part into a named const";
const PREFIX = 'export const a = "';
/** A string that ends its line, so its closing quote is the last column: `width` columns wide. */
function stringLine(width: number) {
  return `${PREFIX}${"x".repeat(width - PREFIX.length - 1)}"`;
}
/** A string that ends its line with `count` of `fill` in it, whatever their width. */
function filled(count: number, fill: string) {
  return `${PREFIX}${fill.repeat(count)}"`;
}
const FILL_COLUMNS = PRINT_WIDTH - PREFIX.length - 1;

describe("max-line-width", () => {
  it("passes a line of exactly 120 ASCII columns and fails 121 once", () => {
    expect(messagesOf(stringLine(PRINT_WIDTH))).toStrictEqual([]);
    expect(messagesOf(stringLine(PRINT_WIDTH + 1))).toStrictEqual([over(1, STRING_HINT)]);
  });

  it("counts a CJK character as 2 columns", () => {
    expect(messagesOf(filled(FILL_COLUMNS / 2 - 0.5, "漢"))).toStrictEqual([]);
    expect(messagesOf(filled(FILL_COLUMNS / 2 + 0.5, "漢"))).toStrictEqual([over(1, STRING_HINT)]);
  });

  it("counts an emoji as 2 columns", () => {
    expect(messagesOf(filled(FILL_COLUMNS / 2 - 0.5, "😀"))).toStrictEqual([]);
    expect(messagesOf(filled(FILL_COLUMNS / 2 + 0.5, "😀"))).toStrictEqual([over(1, STRING_HINT)]);
  });

  it("counts a combining mark as 0", () => {
    expect(messagesOf(filled(FILL_COLUMNS, "é"))).toStrictEqual([]);
  });

  it("counts an ambiguous-width character as 1", () => {
    expect(messagesOf(filled(FILL_COLUMNS, "±"))).toStrictEqual([]);
    expect(messagesOf(filled(FILL_COLUMNS + 1, "±"))).toStrictEqual([over(1, STRING_HINT)]);
  });
});

describe("max-line-width hints", () => {
  it("hints at a long comment", () => {
    expect(messagesOf(`// ${"word ".repeat(30)}\nexport const a = 1;`)).toStrictEqual([over(33, COMMENT_HINT)]);
  });

  it("hints at the string a line is long by, even when column 121 is the semicolon after it", () => {
    expect(messagesOf(`${stringLine(PRINT_WIDTH)};`)).toStrictEqual([over(1, STRING_HINT)]);
  });

  it("hints at a long template", () => {
    const code = `export const a = \`${"x".repeat(110)}\`;`;
    expect(messagesOf(code)).toStrictEqual([over(10, STRING_HINT)]);
  });

  it("hints at a long regex", () => {
    const code = `export const a = /${"x".repeat(110)}/;`;
    expect(messagesOf(code)).toStrictEqual([over(10, REGEX_HINT)]);
  });

  it("hints at long code", () => {
    const code = `export const a = [${"1, ".repeat(40)}];`;
    expect(messagesOf(code)).toStrictEqual([over(20, CODE_HINT)]);
  });
});

describe("max-line-width exemptions", () => {
  it("passes a line that is long only by its URL", () => {
    const url = `https://example.com/${"p".repeat(120)}`;
    expect(messagesOf(`// see ${url}\nexport const a = 1;`)).toStrictEqual([]);
  });

  it("fails a short URL on a line that is long without it", () => {
    const code = `// ${"word ".repeat(30)} https://example.com/a\nexport const a = 1;`;
    expect(messagesOf(code)).toHaveLength(1);
  });

  it("reports each long line once", () => {
    const code = `${stringLine(130)}\nexport const b = 1;\n${stringLine(125)}\n`;
    expect(messagesOf(code)).toStrictEqual([over(10, STRING_HINT), over(5, STRING_HINT)]);
  });
});
