import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noSideEffectImport } from "./no-side-effect-import.ts";

function message(specifier: string) {
  return `import "${specifier}" runs a module for its effects; import a function from it and call that`;
}
function messagesOf(code: string) {
  return reportsOf(noSideEffectImport, { "a.ts": code }).map((report) => report.message);
}

describe("no-side-effect-import", () => {
  it.each([
    'import { install } from "./polyfill.ts";',
    'import polyfill from "./polyfill.ts";',
    'import * as polyfill from "./polyfill.ts";',
    'import type {} from "./types.ts";',
    'export * from "./polyfill.ts";',
    'export { install } from "./polyfill.ts";',
  ])("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each([
    ['import "./polyfill.ts";', "./polyfill.ts"],
    ['import "zod";', "zod"],
    ['import {} from "./polyfill.ts";', "./polyfill.ts"],
  ])("fails %j naming its specifier", (code, specifier) => {
    expect(messagesOf(code)).toStrictEqual([message(specifier)]);
  });
});
