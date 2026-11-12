/**
 * The node type for parser output (oxc, the TypeScript ESTree), the guards that read a value as a node, a list, a
 * string or a literal of one kind, and the text a value spells.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import type { parseSync } from "oxc-parser";

type OxcProgram = ReturnType<typeof parseSync>["program"];

/** A value a syntax node holds: a literal's value (bigint and RegExp included), a child node or a list of them. */
export type SyntaxValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | bigint
  | RegExp
  | SyntaxNode
  | readonly SyntaxValue[];

/** A syntax node read off parser output, keyed by its field names. */
export type SyntaxNode = { readonly [key: string]: SyntaxValue };

/** A parser's typed output the reads take as it is: an oxc program, its body or a statement, an ESTree node or list. */
export type ParserOutput =
  | OxcProgram
  | OxcProgram["body"]
  | OxcProgram["body"][number]
  | TSESTree.Node
  | readonly TSESTree.Node[];

/** True for a non-null object that is not an array, which is how parser output holds a node. */
function isSyntaxNode(value: SyntaxValue | ParserOutput): value is SyntaxNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for an array, which is how parser output holds a list of children. */
export function isSyntaxList(value: SyntaxValue): value is readonly SyntaxValue[] {
  return Array.isArray(value);
}

/** True for a string a node holds, such as its `type` or a literal's value; false for any other syntax value. */
export function isSyntaxString(value: SyntaxValue): value is string {
  return typeof value === "string";
}

/** True for a literal holding a string, false for a number, boolean, null, regex or bigint literal. */
export function isStringLiteral(node: TSESTree.Literal): node is TSESTree.StringLiteral {
  return typeof node.value === "string";
}

/** True for a `true` or `false` literal, false for a string, number, null, regex or bigint literal. */
export function isBooleanLiteral(node: TSESTree.Literal): node is TSESTree.BooleanLiteral {
  return typeof node.value === "boolean";
}

/** `value`, a syntax value or a parser's typed output, as a node; null when it is an array, a primitive or null. */
export function asNode(value: SyntaxValue | ParserOutput): SyntaxNode | null {
  return isSyntaxNode(value) ? value : null;
}

/** `value` as text: a literal as `String` spells it, and a node or a list, which has no text of its own, as "". */
export function textOf(value: SyntaxValue): string {
  if (value instanceof RegExp || !(isSyntaxNode(value) || isSyntaxList(value))) return String(value);

  return "";
}
