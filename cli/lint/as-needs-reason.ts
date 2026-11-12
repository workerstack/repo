import { AST_NODE_TYPES, AST_TOKEN_TYPES, type TSESTree } from "@typescript-eslint/utils";

import { CONST_TYPE } from "./const-type.constants.ts";
import { isReason } from "./is-reason.ts";
import type { RepoRule, RuleComment } from "./rule.types.ts";

const AS_KEYWORD = /\bas\b/;
const LINE_BEFORE_AS = /^[\s)]*as\b/;

/** `as const` and `as unknown` claim nothing a reader must trust. */
function claimsNothing(type: TSESTree.TypeNode): boolean {
  if (type.type === AST_NODE_TYPES.TSUnknownKeyword) return true;
  return (
    type.type === AST_NODE_TYPES.TSTypeReference &&
    type.typeName.type === AST_NODE_TYPES.Identifier &&
    type.typeName.name === CONST_TYPE
  );
}

/**
 * A block reason may sit anywhere before the `as`; a line reason must end the line, or the parenthesis, right before
 * it.
 */
function endsReason(text: string, comment: RuleComment): boolean {
  return comment.type === AST_TOKEN_TYPES.Block || LINE_BEFORE_AS.test(text.slice(comment.range[1]));
}

/** Whether a comment of a reason lies after the expression and before the `as` keyword. */
function hasReason(text: string, comments: readonly RuleComment[], node: TSESTree.TSAsExpression): boolean {
  let edge = node.expression.range[1];
  for (const comment of comments) {
    const [start, end] = comment.range;
    if (start < edge || end > node.typeAnnotation.range[0]) continue;
    if (AS_KEYWORD.test(text.slice(edge, start))) return false;
    if (isReason(comment.value) && endsReason(text, comment)) return true;
    edge = end;
  }
  return false;
}

/**
 * Fails an `as` cast with no reason right before its keyword: `x as Foo` tells the checker to trust it, so the reader
 * is told why. `as const` and `as unknown` pass; `<Foo>x` is native `typescript/consistent-type-assertions`'.
 */
export const asNeedsReason: RepoRule<"reason"> = {
  create(context) {
    return {
      TSAsExpression(node) {
        if (claimsNothing(node.typeAnnotation)) return;
        const { text } = context.sourceCode;
        if (hasReason(text, context.sourceCode.getAllComments(), node)) return;
        const type = text.slice(...node.typeAnnotation.range);
        context.report({ data: { type }, messageId: "reason", node });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: {
      reason:
        '"as {{type}}" needs a reason: write x /* why the type holds */ as {{type}}, ' +
        "or narrow with a check or a schema parse",
    },
    schema: [],
    type: "problem",
  },
};
