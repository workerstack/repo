import { describe, expect, it } from "vitest";

import type { Json } from "../json.ts";
import { jsonText } from "./json-text.ts";

describe("jsonText", () => {
  it.each<[Json | undefined, string]>([
    [42, "42"],
    ["abc", "abc"],
    [true, "true"],
    [null, "null"],
    [undefined, "undefined"],
  ])("prints the primitive %j as String does", (value, text) => {
    expect(jsonText(value)).toBe(text);
  });

  it("prints an object as its JSON", () => {
    expect(jsonText({ id: "g1", score: 0.5 })).toBe('{"id":"g1","score":0.5}');
  });

  it("prints an array as its JSON", () => {
    expect(jsonText([1, "a", null])).toBe('[1,"a",null]');
  });
});
