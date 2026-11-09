import { describe, expect, it } from "vitest";
import { reportsOf } from "../../dev/rule-harness.ts";
import { noMockOfSubject } from "./no-mock-of-subject.ts";

/*
 * Fixtures are source text the harness parses, never run. Each call is spelled through `call` so this file's own text
 * holds no mock call with a relative path, which `dev/vi-mock-paths.test.ts` refuses.
 */
const call = (callee: string, arg: string) => `${callee}(${arg}, () => ({}));\n`;
const bare = (callee: string) => `${callee}();\n`;
const url = (rel: string) => `new URL("${rel}", import.meta.url).href`;
const covers = (specifier: string) =>
  `"${specifier}" is the module this test covers; test it for real and mock what it calls`;
const messagesOf = (file: string, code: string) =>
  reportsOf(noMockOfSubject, { [file]: code }).map((report) => report.message);

describe("no-mock-of-subject passes", () => {
  it.each([
    ["src/parse.test.ts", call("vi.mock", url("./store.ts"))],
    ["src/parse.test.ts", call("vi.mock", '"./store.ts"')],
    ["src/parse.test.ts", call("vi.mock", '"node:fs"')],
    ["src/parse.test.ts", call("vi.mock", '"parse"')],
    ["src/parse.test.ts", call("vi.mock", "somePath")],
    ["src/parse.test.ts", call("vi.mock", "1")],
    ["src/parse.test.ts", call("vi.mock", "other.href")],
    ["src/parse.test.ts", call("vi.mock", 'new Other("./parse.ts", import.meta.url).href')],
    ["src/parse.test.ts", call("vi.mock", 'new URL("./parse.ts", base).href')],
    ["src/parse.test.ts", call("vi.mock", 'new URL("./parse.ts", import.meta.url).pathname')],
    ["src/parse.test.ts", call("vi.mock", 'new URL("./parse.ts")')],
    ["src/parse.test.ts", call("vi.unmock", '"./parse.ts"')],
    ["src/parse.test.ts", call("other.mock", '"./parse.ts"')],
    ["src/parse.test.ts", call("mock", '"./parse.ts"')],
    ["src/parse.test.ts", bare("vi.mock")],
    ["src/other/parse.test.ts", call("vi.mock", url("../parse.ts"))],
    ["src/parse.ts", call("vi.mock", url("./parse.ts"))],
    ["src/parse.e2e.ts", call("vi.mock", url("./parse.ts"))],
  ])("passes %s: %j", (file, code) => {
    expect(messagesOf(file, code)).toEqual([]);
  });
});

describe("no-mock-of-subject fails", () => {
  it.each([
    ["src/parse.test.ts", call("vi.mock", url("./parse.ts")), "./parse.ts"],
    ["src/parse.test.ts", call("vi.mock", '"./parse.ts"'), "./parse.ts"],
    ["src/parse.test.ts", call("vi.mock", '"./parse"'), "./parse"],
    ["src/parse.test.ts", call("vi.mock", '"./parse.js"'), "./parse.js"],
    ["src/parse.test.ts", call("vi.doMock", url("./parse.ts")), "./parse.ts"],
    ["src/parse.test.ts", call("jest.mock", '"./parse.ts"'), "./parse.ts"],
    ["src/parse.spec.ts", call("vi.mock", url("./parse.ts")), "./parse.ts"],
    ["src/parse.test.tsx", call("vi.mock", url("./parse.tsx")), "./parse.tsx"],
    ["src/test/parse.test.ts", call("vi.mock", url("../test/parse.ts")), "../test/parse.ts"],
  ])("fails %s: %j", (file, code, specifier) => {
    expect(messagesOf(file, code)).toEqual([covers(specifier)]);
  });
});
