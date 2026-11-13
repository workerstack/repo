import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { cacheKey, openCache } from "./cache.ts";

const parts = { input: "in", maxTokens: 100, model: "m", sample: 0, system: "sys" };
const done = { inputTokens: 3, outputTokens: 4, text: "hello" };

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cache-"));
});

afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});

it("returns what was set", () => {
  const cache = openCache(dir);
  const key = cacheKey(parts);

  cache.set(key, done);

  expect(cache.get(key)).toStrictEqual(done);
});

it("misses a key never set", () => {
  expect(openCache(dir).get(cacheKey(parts))).toBeUndefined();
});

it.each([
  ["model", { model: "other" }],
  ["maxTokens", { maxTokens: 101 }],
  ["system", { system: "other" }],
  ["input", { input: "other" }],
  ["sample", { sample: 1 }],
])("changes the key when %s changes", (_name, change) => {
  expect(cacheKey({ ...parts, ...change })).not.toBe(cacheKey(parts));
});

it("gives the same key for the same parts", () => {
  expect(cacheKey({ ...parts })).toBe(cacheKey(parts));
});

it.each([
  ["corrupt", "{not json"],
  ["wrong shape", JSON.stringify({ text: 1 })],
])("misses on a %s file", (_name, content) => {
  const cache = openCache(dir);
  const key = cacheKey(parts);

  fs.writeFileSync(path.join(dir, `${key}.json`), content);

  expect(cache.get(key)).toBeUndefined();
});
