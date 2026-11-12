import { describe, expect, it } from "vitest";

import { asNode } from "./syntax-node.ts";

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
