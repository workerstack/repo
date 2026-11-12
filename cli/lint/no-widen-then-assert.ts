/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-widen-then-assert.ts`. */
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { resolveVariable } from "./resolve-variable.ts";
import type { RepoRule } from "./rule.types.ts";
import { functionBoundary, type WidenedBinding, widenedBinding } from "./widen-evidence.ts";
import {
  broadTypeKind,
  isDefinitelyNarrowerRecordType,
  isDefinitelyObjectType,
  typesHaveSameSyntax,
} from "./widen-types.ts";

const MESSAGE =
  'Binding "{{name}}" discards type evidence and later recreates it with an assertion. ' +
  "Keep the precise type from initialization through use; parse boundary input once.";

/** Whether asserting the widened binding to `asserted` claims more than its broad type: the evidence it threw away. */
function assertionIsNarrower(
  sourceCode: Readonly<TSESLint.SourceCode>,
  widened: WidenedBinding,
  asserted: TSESTree.TypeNode,
): boolean {
  if (broadTypeKind(asserted) !== null) return false;

  if (widened.broadKind === "top") return true;

  if (typesHaveSameSyntax(sourceCode, widened.evidence.type, asserted)) return true;

  return widened.broadKind === "object" ? isDefinitelyObjectType(asserted) : isDefinitelyNarrowerRecordType(asserted);
}

/** The name of the binding `node` asserts back narrower after it widened, in the same function; null otherwise. */
function rewidenedName(
  sourceCode: Readonly<TSESLint.SourceCode>,
  node: TSESTree.TSAsExpression | TSESTree.TSTypeAssertion,
): string | null {
  const { expression } = node;

  if (expression.type !== AST_NODE_TYPES.Identifier) return null;
  const variable = resolveVariable(sourceCode, expression);
  const widened = variable === null ? null : widenedBinding(sourceCode, variable);

  if (widened === null || node.range[0] <= widened.declaredAt || functionBoundary(node) !== widened.boundary)
    return null;

  return assertionIsNarrower(sourceCode, widened, node.typeAnnotation) ? expression.name : null;
}

/** Fails a const that widens a known value to `unknown`, `object` or a broad record and is later asserted narrower. */
export const noWidenThenAssert: RepoRule<"widenThenAssert"> = {
  create(context) {
    function check(node: TSESTree.TSAsExpression | TSESTree.TSTypeAssertion): void {
      const name = rewidenedName(context.sourceCode, node);

      if (name !== null) context.report({ data: { name }, messageId: "widenThenAssert", node });
    }

    return { TSAsExpression: check, TSTypeAssertion: check };
  },
  defaultOptions: [],
  meta: {
    messages: { widenThenAssert: MESSAGE },
    schema: [],
    type: "problem",
  },
};
