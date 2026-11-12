import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noModuleMocking } from "./no-module-mocking.ts";

// Fixtures are source text the harness parses, never run. Each call is spelled through `call` with a bare specifier, so
// this file's own text holds no mock call with a relative path, which `dev/vi-mock-paths.test.ts` refuses.
function call(callee: string) {
  return `${callee}("node:fs", () => ({}));\n`;
}

function message(callee: string) {
  return (
    `${callee} replaces a module for the whole file; ` +
    "pass the fake through a parameter, an options field or a real stream instead"
  );
}

function messagesOf(code: string) {
  return reportsOf(noModuleMocking, { "a.test.ts": code }).map((report) => report.message);
}

describe("no-module-mocking passes", () => {
  it.each([
    call("vi.fn"),
    call("vi.spyOn"),
    call("vi.unmock"),
    call("vi.doUnmock"),
    call("vi.importActual"),
    call("jest.requireActual"),
    call("mock"),
    call("other.mock"),
    call("vi.mocked"),
    call("vi[method]"),
    call('vi["fn"]'),
    call("vi[0]"),
    call("vi.a.mock"),
    call("this.mock"),
    "class A extends B { constructor() { super(); } }\n",
    `class A {\n  #mock = 1;\n  run() {\n${call("vi.#mock")}  }\n}\n`,
    `const vi = { mock() {} };\n${call("vi.mock")}`,
    `function run(jest: { doMock(): void }) {\n${call("jest.doMock")}}\n`,
    `import { vi } from "other";\n${call("vi.mock")}`,
    `import vi from "vitest";\n${call("vi.mock")}`,
    `import { jest as vi } from "vitest";\n${call("vi.mock")}`,
    `import { vi as jest } from "@jest/globals";\n${call("jest.mock")}`,
    `import * as vi from "vitest";\n${call("vi.mock")}`,
  ])("%j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });
});

describe("no-module-mocking fails", () => {
  it.each([
    [call("vi.mock"), "vi.mock"],
    [call("vi.doMock"), "vi.doMock"],
    [call("vi.unstable_mockModule"), "vi.unstable_mockModule"],
    [call("jest.mock"), "jest.mock"],
    [call("jest.doMock"), "jest.doMock"],
    [call("jest.unstable_mockModule"), "jest.unstable_mockModule"],
    [call('vi["mock"]'), 'vi["mock"]'],
    [call("jest['doMock']"), "jest['doMock']"],
    [call("vi.mock?."), "vi.mock"],
    [`import { vi } from "vitest";\n${call("vi.mock")}`, "vi.mock"],
    [`import { vi as v } from "vitest";\n${call("v.doMock")}`, "v.doMock"],
    [`import { jest } from "@jest/globals";\n${call("jest.mock")}`, "jest.mock"],
    [`import { jest as j } from "@jest/globals";\n${call("j.unstable_mockModule")}`, "j.unstable_mockModule"],
    [`import { "vi" as v } from "vitest";\n${call("v.mock")}`, "v.mock"],
    [`const vi = { mock() {} };\nfunction run() {\n${call("jest.mock")}}\n`, "jest.mock"],
  ] as const)("%j", (code, callee) => {
    expect(messagesOf(code)).toStrictEqual([message(callee)]);
  });

  it("reports each call once", () => {
    expect(messagesOf(call("vi.mock") + call("vi.doMock"))).toStrictEqual([message("vi.mock"), message("vi.doMock")]);
  });
});
