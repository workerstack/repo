/**
 * Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/vendor/eslint-stylistic/padding-line-between-statements.ts`
 * `getActualLastToken`, from eslint-stylistic (MIT, see eslint-stylistic.LICENSE).
 */
import { AST_TOKEN_TYPES, ESLintUtils, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { SEMICOLON } from "./readable-spacing.constants.ts";

/**
 * The last token of `node`, skipping a semicolon-less style's leading semicolon: in `foo()\n;[1].forEach(bar)` the
 * `;` that ends `foo()` sits on the next statement's line, so `)` is the last token.
 */
export function actualLastToken(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): TSESTree.Token {
  const last = ESLintUtils.nullThrows(
    sourceCode.getLastToken(node),
    ESLintUtils.NullThrowsReasons.MissingToken("last token", node.type),
  );

  if (last.type !== AST_TOKEN_TYPES.Punctuator || last.value !== SEMICOLON) return last;
  const before = sourceCode.getTokenBefore(last);
  const after = sourceCode.getTokenAfter(last);

  const semicolonLess =
    before !== null &&
    after !== null &&
    before.range[0] >= node.range[0] &&
    before.loc.end.line !== last.loc.start.line &&
    last.loc.end.line === after.loc.start.line;

  return semicolonLess ? before : last;
}
