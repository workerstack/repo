/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-runtime-typeof.ts`. */
import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import type { RepoRule } from "./rule.types.ts";
import { UNDEFINED } from "./skip-on-platform.constants.ts";

const MESSAGE =
  "A `typeof` check narrows a representation without establishing its contract. " +
  "Parse input at its I/O boundary, then branch on the domain value.";

const EQUALITY: readonly string[] = ["===", "!==", "==", "!="];

/** A function a `typeof` inside it runs in. */
type RuntimeFunction = TSESTree.ArrowFunctionExpression | TSESTree.FunctionDeclaration | TSESTree.FunctionExpression;

function isRuntimeFunction(node: TSESTree.Node): node is RuntimeFunction {
  return (
    node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionDeclaration ||
    node.type === AST_NODE_TYPES.FunctionExpression
  );
}

/** Whether the nearest function around `node` returns a type predicate, `value is X` or `asserts value is X`. */
function isInsideTypeGuard(node: TSESTree.Node): boolean {
  let current: TSESTree.Node = node;

  while (current.type !== AST_NODE_TYPES.Program) {
    if (isRuntimeFunction(current))
      return (current.returnType ?? undefined)?.typeAnnotation.type === AST_NODE_TYPES.TSTypePredicate;

    current = current.parent;
  }

  return false;
}

/** Whether `node` probes for a possibly absent binding: compared, by any equality, to the string "undefined". */
function isExistenceProbe(node: TSESTree.UnaryExpression): boolean {
  const { parent } = node;

  if (parent.type !== AST_NODE_TYPES.BinaryExpression || !EQUALITY.includes(parent.operator)) return false;
  const other = parent.left === node ? parent.right : parent.left;

  return other.type === AST_NODE_TYPES.Literal && other.value === UNDEFINED;
}

/**
 * Fails a runtime `typeof`, which narrows a value's representation without decoding it into a domain type. An
 * existence probe (`typeof document === "undefined"`) passes, and so does a `typeof` whose nearest function is a type
 * predicate or assertion function; a function nested inside one is its own scope and fails.
 */
export const noRuntimeTypeof: RepoRule<"runtimeTypeof"> = {
  create(context) {
    return {
      UnaryExpression(node) {
        if (node.operator === "typeof" && !isExistenceProbe(node) && !isInsideTypeGuard(node))
          context.report({ messageId: "runtimeTypeof", node });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { runtimeTypeof: MESSAGE },
    schema: [],
    type: "problem",
  },
};
