import { expect, it } from "vitest";

import { commentLines } from "./comment-lines.ts";

it("turns a one-line comment into one // line", () => {
  expect(commentLines(" ignore ", 4)).toStrictEqual(["// ignore"]);
});

it("drops the * decoration and the blank first and last lines", () => {
  const value = "\n   * A syntax error leaves no statement checked,\n   * so the file is skipped.\n   ";
  expect(commentLines(value, 2)).toStrictEqual([
    "// A syntax error leaves no statement checked,",
    "// so the file is skipped.",
  ]);
});

it("keeps a deeper indent behind the decoration", () => {
  expect(commentLines("\n * name   kind\n *   a    1\n ", 0)).toStrictEqual(["// name   kind", "//   a    1"]);
});

it("strips continuation indent to the comment's column when a line lacks the decoration", () => {
  expect(commentLines(" kinds:\n  name   what\n    deeper\n", 2)).toStrictEqual([
    "// kinds:",
    "// name   what",
    "//   deeper",
  ]);
});

it("does not strip a star from a comment where some line has none", () => {
  expect(commentLines(" a\n * b\n c ", 1)).toStrictEqual(["// a", "// * b", "// c"]);
});

it("writes // alone for an empty or blank inner line", () => {
  expect(commentLines(" a\n *\n * b\n   \n * c ", 1)).toStrictEqual(["// a", "//", "// b", "//", "// c"]);
});

it("gives one empty // line for an empty comment", () => {
  expect(commentLines("", 0)).toStrictEqual(["//"]);
  expect(commentLines("\n \n", 0)).toStrictEqual(["//"]);
});

it("drops a carriage return left by a CRLF break", () => {
  expect(commentLines("\r\n * one\r\n * two\r\n ", 0)).toStrictEqual(["// one", "// two"]);
});

it("flushes continuation lines that hang under the first line's text", () => {
  expect(commentLines(" The compiler prints\n   a path so a mark\n   passes alone. ", 0)).toStrictEqual([
    "// The compiler prints",
    "// a path so a mark",
    "// passes alone.",
  ]);
  expect(commentLines(" The compiler prints\n     a path so a mark\n     passes alone. ", 2)).toStrictEqual([
    "// The compiler prints",
    "// a path so a mark",
    "// passes alone.",
  ]);
});

it("flushes continuation lines at the comment's column", () => {
  expect(commentLines(" The compiler\n  prints a path ", 2)).toStrictEqual(["// The compiler", "// prints a path"]);
});

it("flushes an indented body of a bare opener and keeps a table's extra indent", () => {
  expect(commentLines("\n  Kinds:\n      name   what\n      a      one\n  done\n", 0)).toStrictEqual([
    "// Kinds:",
    "//     name   what",
    "//     a      one",
    "// done",
  ]);
});

it("keeps the indent of a line one deeper than the text column", () => {
  expect(commentLines(" text\n   a\n    b\n   c", 0)).toStrictEqual(["// text", "// a", "//  b", "// c"]);
});

it("caps the strip at the text column when every line is deeper", () => {
  expect(commentLines(" text\n     a\n     b", 0)).toStrictEqual(["// text", "//   a", "//   b"]);
});

it("strips nothing from a comment of one line", () => {
  expect(commentLines("\n  only\n", 0)).toStrictEqual(["// only"]);
});
