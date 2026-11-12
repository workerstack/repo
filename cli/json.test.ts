import { describe, expect, it } from "vitest";
import { z } from "zod";

import { isBoolean, isNumber, isRecord, isString, isStringList, type Json, readJson, tryJson } from "./json.ts";

const named = z.object({ name: z.string() });

describe("isRecord", () => {
  it.each<[Json]>([[{}], [{ a: 1 }], [{ nested: { list: [1, "a", null] } }]])("accepts the object %j", (value) => {
    expect(isRecord(value)).toBe(true);
  });

  it.each<[Json | undefined]>([[null], [undefined], [[]], [[1]], ["{}"], [7]])("rejects %j", (value) => {
    expect(isRecord(value)).toBe(false);
  });
});

describe("isString", () => {
  it.each<[Json]>([[""], ["a"]])("accepts %j", (value) => {
    expect(isString(value)).toBe(true);
  });

  it.each<[Json | undefined]>([[7], [true], [null], [undefined], [["a"]], [{ a: "a" }]])("rejects %j", (value) => {
    expect(isString(value)).toBe(false);
  });
});

describe("isNumber", () => {
  it.each<[Json]>([[0], [-1.5]])("accepts %j", (value) => {
    expect(isNumber(value)).toBe(true);
  });

  it.each<[Json | undefined]>([["7"], [false], [null], [undefined], [[7]], [{ a: 7 }]])("rejects %j", (value) => {
    expect(isNumber(value)).toBe(false);
  });
});

describe("isBoolean", () => {
  it.each<[Json]>([[true], [false]])("accepts %j", (value) => {
    expect(isBoolean(value)).toBe(true);
  });

  it.each<[Json | undefined]>([["true"], [0], [null], [undefined], [[true]], [{ a: true }]])("rejects %j", (value) => {
    expect(isBoolean(value)).toBe(false);
  });
});

describe("isStringList", () => {
  it.each<[Json]>([[[]], [["a", "b"]]])("accepts %j", (value) => {
    expect(isStringList(value)).toBe(true);
  });

  const rejected: [Json | undefined][] = [[["a", 7]], [[null]], ["a"], [null], [undefined], [{ a: "a" }]];

  it.each(rejected)("rejects %j", (value) => {
    expect(isStringList(value)).toBe(false);
  });
});

describe("readJson", () => {
  it("returns the shape the schema reads", () => {
    expect(readJson(named, '{"name":"a"}')).toStrictEqual({ name: "a" });
  });

  it("rethrows JSON.parse's SyntaxError for text that is not JSON", () => {
    expect(() => readJson(named, "{")).toThrowError(SyntaxError);
  });

  it("throws the prettified issues for a shape the schema refuses", () => {
    expect(() => readJson(named, '{"name":1}')).toThrowError(
      new Error("✖ Invalid input: expected string, received number\n  → at name"),
    );
  });
});

describe("tryJson", () => {
  it("returns the shape the schema reads", () => {
    expect(tryJson(named, '{"name":"a"}')).toStrictEqual({ name: "a" });
  });

  it.each([
    ["text that is not JSON", "{"],
    ["a shape the schema refuses", '{"name":1}'],
  ])("returns undefined for %s", (_name, text) => {
    expect(tryJson(named, text)).toBeUndefined();
  });
});
