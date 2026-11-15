import { describe, expect, it } from "vitest";

import { fixedOf, reportsOf } from "../../dev/rule-harness.ts";
import { MESSAGE } from "./prefer-called-with.constants.ts";
import { preferCalledWith } from "./prefer-called-with.ts";

const HEAD = 'import { expect, it, vi } from "vitest";\n\nit("calls", () => {\n  const f = vi.fn();\n  f();\n';

/** A test body holding `assertion` after one call. */
function testOf(assertion: string): string {
  return `${HEAD}  ${assertion}\n});\n`;
}

describe("prefer-called-with", () => {
  it.each([
    "expect(f).toHaveBeenCalled();",
    "expect(f).toBeCalled();",
    "expect.soft(f).toHaveBeenCalled();",
    "expect(f).resolves.toHaveBeenCalled();",
  ])("reports %s and leaves the code", (line) => {
    const code = testOf(line);
    expect(reportsOf(preferCalledWith, { "a.test.ts": code }).map((report) => report.message)).toStrictEqual([MESSAGE]);
    expect(fixedOf(preferCalledWith, code)).toBe(code);
  });

  it.each([
    "expect(f).not.toHaveBeenCalled();",
    "expect(f).toHaveBeenCalledWith(1);",
    "expect(f).toHaveBeenCalledTimes(1);",
    'expect(f)["toHaveBeenCalled"]();',
    "other(f).toHaveBeenCalled();",
    "f.toHaveBeenCalled();",
    "other.soft(f).toHaveBeenCalled();",
  ])("passes %s", (line) => {
    expect(reportsOf(preferCalledWith, { "a.test.ts": testOf(line) })).toStrictEqual([]);
  });
});
