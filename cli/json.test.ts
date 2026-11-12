import { describe, expect, it } from "vitest";
import { z } from "zod";

import { isRecord, type Json, readJson, tryJson } from "./json.ts";

const named = z.object({ name: z.string() });

describe("isRecord", () => {
  it.each<[Json]>([[{}], [{ a: 1 }], [{ nested: { list: [1, "a", null] } }]])("accepts the object %j", (value) => {
    expect(isRecord(value)).toBe(true);
  });

  it.each<[Json | undefined]>([[null], [undefined], [[]], [[1]], ["{}"], [7]])("rejects %j", (value) => {
    expect(isRecord(value)).toBe(false);
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
