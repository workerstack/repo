import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { packageJsonSchema, readJsonFile } from "./package-json.ts";
import { tempDir, useTempDirs } from "./sync/__fixtures__/temp-dirs.ts";

useTempDirs();

it("accepts a package.json whose names and maps hold strings and keeps its other keys", () => {
  const pkg = { name: "app", private: true, scripts: { test: "x" }, version: "1.0.0" };

  expect(packageJsonSchema.parse(pkg)).toStrictEqual(pkg);
});

it.each([
  ["an array", []],
  ["null", null],
  ["a numeric name", { name: 1 }],
  ["a numeric version", { version: 1 }],
  ["a script that is not a string", { scripts: { a: 1 } }],
  ["dependencies as a string", { dependencies: "x" }],
])("refuses %s", (_name, value) => {
  expect(packageJsonSchema.safeParse(value).success).toBe(false);
});

it("reads a file through the schema", () => {
  const file = path.join(tempDir("pj-read-"), "package.json");
  fs.writeFileSync(file, '{"name":"app"}');

  expect(readJsonFile(file, packageJsonSchema)).toStrictEqual({ name: "app" });
});

it("throws the issues naming the key a file gets wrong", () => {
  const file = path.join(tempDir("pj-wrong-"), "package.json");
  fs.writeFileSync(file, '{"version":1}');

  expect(() => readJsonFile(file, packageJsonSchema)).toThrowError(
    `${file}: ✖ Invalid input: expected string, received number\n  → at version`,
  );
});

it("names the file in the error for text that is not JSON", () => {
  const file = path.join(tempDir("pj-bad-"), "package.json");
  fs.writeFileSync(file, "{");

  expect(() => readJsonFile(file, packageJsonSchema)).toThrowError(`${file}: `);
});
