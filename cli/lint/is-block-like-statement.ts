/**
 * Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/vendor/eslint-stylistic/padding-line-between-statements.ts`
 * `isBlockLikeStatement` and `isIIFEStatement`, from eslint-stylistic (MIT, see eslint-stylistic.LICENSE).
 */
import { AST_NODE_TYPES, AST_TOKEN_TYPES, ESLintUtils, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { BLOCK_OWNERS, CLOSING_BRACE, FUNCTION_TYPES, SEMICOLON } from "./readable-spacing.constants.ts";

/** `node` without an optional chain around it. */
function unchained(node: TSESTree.Node): TSESTree.Node {
  return node.type === AST_NODE_TYPES.ChainExpression ? node.expression : node;
}

/** Whether `node` is a statement that calls a function expression in place, `(() => {})()` or `!function () {}()`. */
function isIIFEStatement(node: TSESTree.Node): boolean {
  if (node.type !== AST_NODE_TYPES.ExpressionStatement) return false;
  let expression = unchained(node.expression);

  if (expression.type === AST_NODE_TYPES.UnaryExpression) expression = unchained(expression.argument);

  if (expression.type !== AST_NODE_TYPES.CallExpression) return false;
  let callee: TSESTree.Node = expression.callee;

  while (callee.type === AST_NODE_TYPES.SequenceExpression) {
    const expressions: readonly TSESTree.Expression[] = callee.expressions;
    callee = ESLintUtils.nullThrows(expressions[expressions.length - 1], "a sequence expression has expressions");
  }

  return FUNCTION_TYPES.includes(callee.type);
}

/**
 * Whether `node` ends a block: a do-while over a block, an IIFE, or a statement whose last token past any `;` is the
 * closing brace of a block or switch, as a function, `if` or arrow-bodied const ends.
 */
export function isBlockLikeStatement(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  if (node.type === AST_NODE_TYPES.DoWhileStatement && node.body.type === AST_NODE_TYPES.BlockStatement) return true;

  if (isIIFEStatement(node)) return true;

  const last = sourceCode.getLastToken(
    node,
    (token) => token.type !== AST_TOKEN_TYPES.Punctuator || token.value !== SEMICOLON,
  );

  if (last?.type !== AST_TOKEN_TYPES.Punctuator || last.value !== CLOSING_BRACE) return false;
  const owner = sourceCode.getNodeByRangeIndex(last.range[0]);

  return owner !== null && BLOCK_OWNERS.includes(owner.type);
}
