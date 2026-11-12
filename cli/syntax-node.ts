/** The node type for parser output (oxc, the TypeScript ESTree) and the one guard that reads a value as a node. */

/** A value a syntax node holds: a literal's value (bigint and RegExp included), a child node or a list of them. */
type SyntaxValue = string | number | boolean | null | undefined | bigint | RegExp | SyntaxNode | readonly SyntaxValue[];

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
