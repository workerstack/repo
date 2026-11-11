import { expect, it } from "vitest";

import { exactTextRe } from "./exact-text-re.ts";

it("matches the joined parts as plain text, regex syntax included", () => {
  const re = exactTextRe("see [a](../b/SKILL.md) ", "(c*) $1? {2}|^x\\y");
  expect(re.test("x see [a](../b/SKILL.md) (c*) $1? {2}|^x\\y z")).toBe(true);
  expect(re.test("see [a](../b/SKILLxmd) (c*) $1? {2}|^x\\y")).toBe(false);
  expect(re.flags).toBe("");
});
