/** Ported from @vitest/eslint-plugin (MIT, see vitest-eslint-plugin.LICENSE): `src/rules/prefer-called-with.ts`. */
import { AST_NODE_TYPES } from "@typescript-eslint/types";
import type { TSESTree } from "@typescript-eslint/utils";

import { EXPECT, MATCHERS, MESSAGE, NOT } from "./prefer-called-with.constants.ts";
import type { RepoRule } from "./rule.types.ts";

/** The name `property` gives a member, `toHaveBeenCalled` or `not`; null when it is computed. */
function nameOf(member: TSESTree.MemberExpression): string | null {
  if (member.computed || member.property.type !== AST_NODE_TYPES.Identifier) return null;

  return member.property.name;
}

/** Whether `callee` is `expect` or a member of it such as `expect.soft`. */
function isExpect(callee: TSESTree.Expression): boolean {
  if (callee.type === AST_NODE_TYPES.Identifier) return callee.name === EXPECT;

  return callee.type === AST_NODE_TYPES.MemberExpression && isExpect(callee.object);
}

/** Whether `object`, the left side of a matcher, is an `expect(...)` chain with no `.not`. */
function isPositiveExpectChain(object: TSESTree.Expression): boolean {
  let current = object;

  while (current.type === AST_NODE_TYPES.MemberExpression) {
    if (nameOf(current) === NOT) return false;
    current = current.object;
  }

  return current.type === AST_NODE_TYPES.CallExpression && isExpect(current.callee);
}

/** Fails `toHaveBeenCalled()` and `toBeCalled()` on a positive expect, which assert a call but not what it passed. */
export const preferCalledWith: RepoRule<"calledWith"> = {
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;

        if (callee.type !== AST_NODE_TYPES.MemberExpression || node.arguments.length > 0) return;
        const name = nameOf(callee);

        if (name !== null && MATCHERS.includes(name) && isPositiveExpectChain(callee.object))
          context.report({ messageId: "calledWith", node });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { calledWith: MESSAGE },
    schema: [],
    type: "suggestion",
  },
};
