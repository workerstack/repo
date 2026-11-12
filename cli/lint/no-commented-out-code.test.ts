import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noCommentedOutCode } from "./no-commented-out-code.ts";

const MESSAGE = "this comment is code; delete it, git keeps the old version";

function messagesOf(code: string) {
  return reportsOf(noCommentedOutCode, { "a.ts": code }).map((report) => report.message);
}

describe("no-commented-out-code passes prose and tool comments", () => {
  it.each([
    "// Reads the workspace manifest and returns its packages.\nexport const a = 1;",
    "// TODO mentioned mid-sentence, and a call like load() in prose\nexport const a = 1;",
    "// return early when the list is empty\nexport const a = 1;",
    "// if the file is missing, the caller gets null\nexport const a = 1;",
    "// see https://example.com/docs\nexport const a = 1;",
    "// workspace\nexport const a = 1;",
    "// 42\nexport const a = 1;",
    "// a.b\nexport const a = 1;",
    "// note: see a.b\n// note: a.b\nexport const a = 1;",
    "// e.g. `load()`\nexport const a = 1;",
    "/** const old = load(); */\nexport const a = 1;",
    "/**\n * @example\n * const store = makeStore();\n */\nexport const a = 1;",
    "// @ts-expect-error: the test feeds a bad shape\nexport const a: number = 'x';",
    "// oxlint-disable-next-line eslint/no-console\nconsole.log(1);",
    "// eslint-disable-next-line no-console\nconsole.log(1);",
    "export const a = /* @__PURE__ */ make();\nexport const b = /* #__PURE__ */ make();",
    "/* v8 ignore next */\nexport const a = 1;",
    '/// <reference types="node" />\nexport const a = 1;',
    "/* a block note that only says why */\nexport const a = 1;",
  ])("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });
});

describe("no-commented-out-code fails a comment that parses as code", () => {
  it.each([
    "// const old = load();\nexport const a = 1;",
    "// load();",
    "// store = new Map();",
    "// return value;",
    "// throw new Error('x');",
    "// import { a } from './a.ts';",
    "// export const b = 2;",
    "// function f() {}",
    "// type A = string;",
    "/* const old = load(); */\nexport const a = 1;",
    "export const a = 1; // a = 2;",
  ])("fails %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([MESSAGE]);
  });

  it("reads consecutive line comments as one group, reported once", () => {
    expect(messagesOf("// if (ready) {\n//   start();\n// }\nexport const a = 1;")).toStrictEqual([MESSAGE]);
    expect(messagesOf("// for (const x of xs) {\n//   use(x);\n// }")).toStrictEqual([MESSAGE]);
  });
});

describe("no-commented-out-code reads a group of line comments", () => {
  it("fails a group with prose on one line and code on another, reported once", () => {
    expect(messagesOf("// TODO fix this later\n// const old = load();\nexport const a = 1;")).toStrictEqual([MESSAGE]);
    expect(messagesOf("// load();\n// the old call, kept for reference\nexport const a = 1;")).toStrictEqual([MESSAGE]);
  });

  it("splits groups at a blank line or code, and a directive breaks a group", () => {
    expect(messagesOf("// load();\n\n// save();")).toStrictEqual([MESSAGE, MESSAGE]);
    expect(messagesOf("// if (ready) {\nexport const a = 1;\n// }")).toStrictEqual([]);
    expect(messagesOf("// load();\n// @ts-expect-error: bad\n// save();\nexport const a: number = 'x';")).toStrictEqual(
      [MESSAGE, MESSAGE],
    );
  });
});
