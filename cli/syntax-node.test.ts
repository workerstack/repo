import { describe, expect, it } from "vitest";

import { asNode, isSyntaxList, textOf } from "./syntax-node.ts";

describe("asNode", () => {
  it.each([
    ["an identifier", { name: "a", type: "Identifier" }],
    ["a bigint literal", { type: "Literal", value: 10n }],
    ["a regex literal", { type: "Literal", value: /a/u }],
  ])("returns %s as a node", (_name, node) => {
    expect(asNode(node)).toBe(node);
  });

  it.each([
    ["an array", [{ type: "Identifier" }]],
    ["null", null],
    ["a string", "Identifier"],
  ])("returns null for %s", (_name, value) => {
    expect(asNode(value)).toBeNull();
  });
});

describe("isSyntaxList", () => {
  it("takes a list", () => {
    expect(isSyntaxList([{ type: "Identifier" }])).toBe(true);
  });

  it.each([
    ["a node", { type: "Identifier" }],
    ["a string", "Identifier"],
  ])("rejects %s", (_name, value) => {
    expect(isSyntaxList(value)).toBe(false);
  });
});

describe("textOf", () => {
  it.each([
    ["a string", "Identifier", "Identifier"],
    ["a number", 1, "1"],
    ["a bigint", 10n, "10"],
    ["undefined", undefined, "undefined"],
    ["null", null, "null"],
    ["a regex", /a/u, "/a/u"],
    ["a node", { type: "Identifier" }, ""],
    ["a list", ["a"], ""],
  ])("spells %s", (_name, value, text) => {
    expect(textOf(value)).toBe(text);
  });
});
