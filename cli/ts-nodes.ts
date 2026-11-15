/** What TypeScript 7's nodes leave to the caller that typescript 5.9's helpers read off a node's parents. */
import { ModifierFlags, type Node } from "typescript/unstable/ast";
import type { FunctionDeclaration, PropertyDeclaration, VariableDeclaration } from "typescript/unstable/ast";
import { isSourceFile, isVariableDeclaration, isVariableStatement } from "typescript/unstable/ast/is";

/** A declaration's modifiers; a variable declaration has its statement's, where `export const` writes them. */
export function modifierFlagsOf(node: FunctionDeclaration | PropertyDeclaration | VariableDeclaration): ModifierFlags {
  if (!isVariableDeclaration(node)) return node.modifierFlags;
  const statement = node.parent.parent;

  return isVariableStatement(statement) ? statement.modifierFlags : ModifierFlags.None;
}

/** The nearest of `node` and the nodes around it that passes `test`; undefined when none up to its file does. */
export function ancestorOf<T extends Node>(node: Node, test: (node: Node) => node is T): T | undefined {
  let at = node;

  while (!test(at)) {
    if (isSourceFile(at)) return undefined;
    at = at.parent;
  }

  return at;
}
