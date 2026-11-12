import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { isString, type Json } from "../json.ts";
import { isRustKey, readFloorsFile } from "./floors.ts";

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "floors-test-"));
});

afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});

function write(value: Json): string {
  const file = path.join(dir, "floors.json");
  fs.writeFileSync(file, isString(value) ? value : JSON.stringify(value));

  return file;
}

const TS = { branches: 80, functions: 70, lines: 60, statements: 90 };
const RUST = { functions: 66, lines: 66, regions: 58 };

it("reads both row kinds", () => {
  expect(readFloorsFile(write({ "a/src/lib.rs": RUST, "a/x.ts": TS }))).toStrictEqual({
    "a/src/lib.rs": RUST,
    "a/x.ts": TS,
  });
});

it("is empty for a missing file", () => {
  expect(readFloorsFile(path.join(dir, "none.json"))).toStrictEqual({});
});

it("tells a rust key from any other", () => {
  expect(isRustKey("a/src/lib.rs")).toBe(true);
  expect(isRustKey("a/x.ts")).toBe(false);
});

it("refuses a file that is not JSON", () => {
  const file = write("{nope");
  expect(() => readFloorsFile(file)).toThrow(`${file} is not valid JSON; run \`bun repo coverage\``);
});

it("refuses a file that is not an object", () => {
  expect(() => readFloorsFile(write([]))).toThrow("is not an object of floors");
});

it("refuses a row of the wrong kind or value", () => {
  expect(() => readFloorsFile(write({ "a/x.ts": RUST }))).toThrow("a/x.ts has a bad floor row");
  expect(() => readFloorsFile(write({ "a/lib.rs": TS }))).toThrow("a/lib.rs has a bad floor row");
  expect(() => readFloorsFile(write({ "a/lib.rs": { ...RUST, lines: 101 } }))).toThrow("bad floor row");
  expect(() => readFloorsFile(write({ "a/lib.rs": { ...RUST, lines: 1.5 } }))).toThrow("bad floor row");
  expect(() => readFloorsFile(write({ "a/lib.rs": 5 }))).toThrow("bad floor row");
});
