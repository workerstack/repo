/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-chained-type-assertions.ts`. */
import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import { CONST_TYPE } from "./const-type.constants.ts";
import type { RepoRule } from "./rule.types.ts";

type Assertion = TSESTree.TSAsExpression | TSESTree.TSTypeAssertion;

const MESSAGE =
  "This assertion chain discards type evidence. Keep the original precise type, " +
  "or parse untrusted input at its boundary before narrowing it.";

function isAssertion(node: TSESTree.Node): node is Assertion {
  return node.type === AST_NODE_TYPES.TSAsExpression || node.type === AST_NODE_TYPES.TSTypeAssertion;
}

/** Whether `node` is `as const` or `<const>`. */
function isConstAssertion(node: Assertion): boolean {
  const { typeAnnotation } = node;

  return (
    typeAnnotation.type === AST_NODE_TYPES.TSTypeReference &&
    typeAnnotation.typeName.type === AST_NODE_TYPES.Identifier &&
    typeAnnotation.typeName.name === CONST_TYPE
  );
}

/** Whether `node` asserts no further assertion's operand, so it is the head of its chain. */
function isOutermost(node: Assertion): boolean {
  return !isAssertion(node.parent) || node.parent.expression !== node;
}

/** Whether the chain `node` heads has two or more links, one of them no const assertion. */
function isForbiddenChain(node: Assertion): boolean {
  let links = 0;
  let hasNonConst = false;

  for (let current: TSESTree.Node = node; isAssertion(current); current = current.expression) {
    links += 1;
    hasNonConst ||= !isConstAssertion(current);
  }

  return links > 1 && hasNonConst;
}

/**
 * Fails a chain of `as` or angle-bracket assertions with a link that is no const assertion, as `x as unknown as T`:
 * the middle link drops the type the checker holds so the last can invent one. A chain of const assertions passes.
 * TSESTree drops parentheses, so `(x as unknown) as T` is the same chain.
 */
export const noChainedTypeAssertions: RepoRule<"chained"> = {
  create(context) {
    function check(node: Assertion): void {
      if (isOutermost(node) && isForbiddenChain(node)) context.report({ messageId: "chained", node });
    }

    return { TSAsExpression: check, TSTypeAssertion: check };
  },
  defaultOptions: [],
  meta: {
    messages: { chained: MESSAGE },
    schema: [],
    type: "problem",
  },
};
