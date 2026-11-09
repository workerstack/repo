import { describe, expect, it } from "vitest";
import { reportsOf } from "../../dev/rule-harness.ts";
import { noV8Ignore } from "./no-v8-ignore.ts";

const MESSAGE = "coverage ignore comments hide untested code; delete the code or add a test that runs it";
const messagesOf = (code: string) => reportsOf(noV8Ignore, { "a.ts": code }).map((report) => report.message);

describe("no-v8-ignore", () => {
  it.each([
    "// a plain comment\nexport const a = 1;",
    'export const hint = "/* v8 ignore next */";',
    "/* ignore v8 here */ export const b = 2;",
  ])("passes %j", (code) => {
    expect(messagesOf(code)).toEqual([]);
  });

  it.each([
    ["/* v8 ignore next */\nexport const a = 1;", 1],
    ["export const a = 1;\n// c8 ignore start", 1],
    ["/* istanbul ignore else */ export const a = 1;", 1],
    ["/* V8 Ignore next -- @preserve */ export const a = 1;", 1],
    ["// v8 ignore start\nexport const a = 1;\n// v8 ignore stop", 2],
  ] as const)("fails %j once per comment", (code, count) => {
    expect(messagesOf(code)).toEqual(Array.from({ length: count }, () => MESSAGE));
  });
});
