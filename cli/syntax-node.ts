/**
 * The node type for parser output (oxc, the TypeScript ESTree), the guard that reads a value as a node, and the text a
 * value spells.
 */

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

/** True for a non-null object that is not an array, which is how parser output holds a node. */
function isSyntaxNode(value: unknown): value is SyntaxNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value` as a node, or null when it is an array, a primitive or null. */
export function asNode(value: unknown): SyntaxNode | null {
  return isSyntaxNode(value) ? value : null;
}

/** `value` as text: a literal as `String` spells it, and a node or a list, which has no text of its own, as "". */
export function textOf(value: SyntaxValue): string {
  if (typeof value !== "object" || value === null) return String(value);

  return value instanceof RegExp ? String(value) : "";
}
