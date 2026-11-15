/** What TypeScript 7's nodes leave to the caller that typescript 5.9's helpers read off a node's parents. */
import { ModifierFlags, type Node } from "typescript/unstable/ast";
import type { ClassLikeDeclaration, DeclarationName } from "typescript/unstable/ast";
import {
  isClassDeclaration,
  isClassExpression,
  isSourceFile,
  isVariableDeclaration,
  isVariableStatement,
} from "typescript/unstable/ast/is";

/** What every TS 7 node reads, though only declarations with modifiers type it. */
type Modifiable = { modifierFlags: ModifierFlags };

/** A node's modifiers; a variable declaration has its statement's, where `export const` writes them. */
export function modifierFlagsOf(node: Node): ModifierFlags {
  if (!isVariableDeclaration(node)) return (node /* every TS 7 node reads them */ as Node & Modifiable).modifierFlags;
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

/** Whether a node declares a class, as a statement or an expression. */
export function isClassLike(node: Node): node is ClassLikeDeclaration {
  return isClassDeclaration(node) || isClassExpression(node);
}

/** A declaration's name, computed or not; undefined for a node that has none, such as a constructor. */
export function nameOf(node: Node): DeclarationName | undefined {
  return (node /* every TS 7 node reads `name`, undefined when it has none */ as { name?: DeclarationName }).name;
}
