import { parse } from "@typescript-eslint/parser";
import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { describe, expect, it } from "vitest";

import { asNode, isBooleanLiteral, isStringLiteral, isSyntaxList, isSyntaxString, textOf } from "./syntax-node.ts";

/** The literal `code` spells, parsed as one parenthesized expression. */
function literalOf(code: string): TSESTree.Literal {
  const [statement] = parse(`(${code});`).body;

  if (statement?.type !== AST_NODE_TYPES.ExpressionStatement || statement.expression.type !== AST_NODE_TYPES.Literal)
    throw new Error(`${code} is no literal`);

  return statement.expression;
}

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

describe("isSyntaxString", () => {
  it("takes a string", () => {
    expect(isSyntaxString("Identifier")).toBe(true);
  });

  it.each([
    ["a number", 1],
    ["null", null],
    ["a node", { type: "Identifier" }],
  ])("rejects %s", (_name, value) => {
    expect(isSyntaxString(value)).toBe(false);
  });
});

describe("isStringLiteral", () => {
  it.each(['"a"', "''"])("takes %s", (code) => {
    expect(isStringLiteral(literalOf(code))).toBe(true);
  });

  it.each(["1", "true", "null", "/a/u", "1n"])("rejects %s", (code) => {
    expect(isStringLiteral(literalOf(code))).toBe(false);
  });
});

describe("isBooleanLiteral", () => {
  it.each(["true", "false"])("takes %s", (code) => {
    expect(isBooleanLiteral(literalOf(code))).toBe(true);
  });

  it.each(['"true"', "0", "null"])("rejects %s", (code) => {
    expect(isBooleanLiteral(literalOf(code))).toBe(false);
  });
});
