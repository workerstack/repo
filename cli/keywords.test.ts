import { expect, it } from "vitest";

import { isStringList, keywordLines } from "./keywords.ts";

const P = "package.json: ";
function names(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `k${String(i).padStart(2, "0")}`);
}

it("gives nothing for a valid sorted list", () => {
  expect(keywordLines(["agents", "ci", "lint"])).toStrictEqual([]);
});

it.each([
  [undefined, `${P}"keywords" is missing; list 1 to 20 GitHub topics`],
  [[], `${P}"keywords" is []; list 1 to 20 GitHub topics`],
  ["x", `${P}"keywords" is "x"; list 1 to 20 GitHub topics`],
])("says what a missing, empty or non-array value is: %j", (value, expected) => {
  expect(keywordLines(value)).toStrictEqual([expected]);
});

it("holds 20 entries and refuses 21", () => {
  expect(keywordLines(names(20))).toStrictEqual([]);
  expect(keywordLines(names(21))).toStrictEqual([
    `${P}"keywords" has 21 entries; keep at most 20, GitHub's topic limit`,
  ]);
});

it("holds a 50 character entry and refuses 51", () => {
  expect(keywordLines(["a".repeat(50)])).toStrictEqual([]);
  expect(keywordLines(["a".repeat(51)])).toHaveLength(1);
});

it.each(["-ci", "My Tool", "Lint", "a b", "a_b", ""])("refuses %j as a topic", (keyword) => {
  expect(keywordLines([keyword])).toStrictEqual([
    `${P}keyword "${keyword}" is not a GitHub topic; ` +
      "use lowercase letters, digits and dashes, starting with a letter or digit, at most 50 characters",
  ]);
});

it("names a non-string by its 1-based position", () => {
  expect(keywordLines(["agents", "ci", 7])).toStrictEqual([
    `${P}keyword 3 is 7, not a string; write it as a GitHub topic`,
  ]);
});

it("names a repeated entry and its count", () => {
  expect(keywordLines(["ci", "ci", "ci"])).toStrictEqual([`${P}keyword "ci" is listed 3 times; keep one`]);
});

it("writes the sorted unique list when the order is wrong", () => {
  expect(keywordLines(["lint", "agents"])).toStrictEqual([`${P}"keywords" are not sorted; write ["agents","lint"]`]);
  expect(keywordLines(["lint", "agents", "lint"])).toStrictEqual([
    `${P}keyword "lint" is listed 2 times; keep one`,
    `${P}"keywords" are not sorted; write ["agents","lint"]`,
  ]);
});

it("reports every problem at once, one line each, and skips the order when a non-string is present", () => {
  expect(keywordLines(["Lint", "agents", "ci", "ci"])).toStrictEqual([
    expect.stringContaining('keyword "Lint" is not a GitHub topic'),
    `${P}keyword "ci" is listed 2 times; keep one`,
  ]);
  expect(keywordLines(["lint", "agents", 7])).toStrictEqual([
    `${P}keyword 3 is 7, not a string; write it as a GitHub topic`,
  ]);
});

it("tells a list of strings from one holding anything else", () => {
  expect(isStringList(["a", "b"])).toBe(true);
  expect(isStringList(["a", 7])).toBe(false);
});
