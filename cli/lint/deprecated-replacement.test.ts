import { expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { deprecatedReplacement } from "./deprecated-replacement.ts";

const MESSAGE = '`@deprecated` names no replacement: write "use `newName` instead" or {@link newName}';
const messagesOf = (code: string) => reportsOf(deprecatedReplacement, { "a.ts": code }).map((report) => report.message);

it.each([
  "/** @deprecated */\nexport const a = 1;",
  "/**\n * Old.\n * @deprecated Gone soon.\n */\nexport const a = 1;",
  "/**\n * @deprecated\n * @see b\n */\nexport const a = 1;",
  "/**\n * @deprecated Gone.\n * @see {@link c}\n */\nexport const a = 1;",
])("fails a tag that names no replacement: %j", (code) => {
  expect(messagesOf(code)).toStrictEqual([MESSAGE]);
});

it.each([
  "/** @deprecated use `b` instead */\nexport const a = 1;",
  "/** @deprecated Use `b.c` instead. */\nexport const a = 1;",
  "/** @deprecated {@link b} */\nexport const a = 1;",
  "/**\n * @deprecated Replaced by `b`.\n * @see c\n */\nexport const a = 1;",
])("passes a tag that names a replacement: %j", (code) => {
  expect(messagesOf(code)).toStrictEqual([]);
});

it("passes a block without the tag, a plain block comment and a line comment", () => {
  const code =
    "/** Fine. @deprecated mid-line is no tag. */\nexport const a = 1;\n/* @deprecated */\n// @deprecated\nexport const b = 2;";
  expect(messagesOf(code)).toStrictEqual([]);
});

it("applies to a private, unexported declaration too", () => {
  expect(messagesOf("/** @deprecated */\nfunction hidden(): void {}")).toStrictEqual([MESSAGE]);
});
