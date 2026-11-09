import type { Comment, ESTree, Rule } from "@oxlint/plugins";
import { isReason } from "./is-reason.ts";

const AS_KEYWORD = /\bas\b/;

/** `as const` and `as unknown` claim nothing a reader must trust. */
function claimsNothing(type: ESTree.TSType): boolean {
  if (type.type === "TSUnknownKeyword") return true;
  return type.type === "TSTypeReference" && type.typeName.type === "Identifier" && type.typeName.name === "const";
}

/** Whether a block comment of a reason lies after the expression and before the `as` keyword. */
function hasReason(text: string, comments: readonly Comment[], node: ESTree.TSAsExpression): boolean {
  let edge = node.expression.end;
  for (const comment of comments) {
    if (comment.start < edge || comment.end > node.typeAnnotation.start) continue;
    if (AS_KEYWORD.test(text.slice(edge, comment.start))) return false;
    if (comment.type === "Block" && isReason(comment.value)) return true;
    edge = comment.end;
  }
  return false;
}

/**
 * Fails an `as` cast with no reason right before its keyword: `x as Foo` tells the checker to trust it, so the reader
 * is told why. `as const` and `as unknown` pass; `<Foo>x` is native `typescript/consistent-type-assertions`'.
 */
export const asNeedsReason = {
  create(context) {
    return {
      TSAsExpression(node) {
        if (claimsNothing(node.typeAnnotation)) return;
        const { text } = context.sourceCode;
        if (hasReason(text, context.sourceCode.getAllComments(), node)) return;
        const type = text.slice(node.typeAnnotation.start, node.typeAnnotation.end);
        const message = `"as ${type}" needs a reason: write x /* why the type holds */ as ${type}, or narrow with a check or a schema parse`;
        context.report({ message, node });
      },
    };
  },
} satisfies Rule;
