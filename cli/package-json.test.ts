import { expect, it } from "vitest";

import { isPackageJson } from "./package-json.ts";

it("accepts a package.json whose names and maps hold strings", () => {
  expect(isPackageJson({ name: "app", private: true, scripts: { test: "x" }, version: "1.0.0" })).toBe(true);
});

it.each([
  ["an array", []],
  ["null", null],
  ["a numeric name", { name: 1 }],
  ["a numeric version", { version: 1 }],
  ["a script that is not a string", { scripts: { a: 1 } }],
  ["dependencies as a string", { dependencies: "x" }],
])("refuses %s", (_name, value) => {
  expect(isPackageJson(value)).toBe(false);
});
