/**
 * The node type for parser output (oxc, the TypeScript ESTree), the guards that read a value as a node or a list, and
 * the text a value spells.
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
function isSyntaxNode(value: unknown): value is SyntaxNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for an array, which is how parser output holds a list of children. */
export function isSyntaxList(value: SyntaxValue): value is readonly SyntaxValue[] {
  return Array.isArray(value);
}

/** `value`, a syntax value or a parser's typed output, as a node; null when it is an array, a primitive or null. */
export function asNode(value: SyntaxValue | ParserOutput): SyntaxNode | null {
  return isSyntaxNode(value) ? value : null;
}

/** `value` as text: a literal as `String` spells it, and a node or a list, which has no text of its own, as "". */
export function textOf(value: SyntaxValue): string {
  if (typeof value !== "object" || value === null) return String(value);

  return value instanceof RegExp ? String(value) : "";
}
