/**
 * Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/vendor/eslint-stylistic/padding-line-between-statements.ts`
 * `getPaddingLineSequences`, from eslint-stylistic (MIT, see eslint-stylistic.LICENSE).
 */
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

import { actualLastToken } from "./actual-last-token.ts";
import { PADDING_LINES } from "./readable-spacing.constants.ts";

/**
 * Whether a blank line sits anywhere between `prev`'s actual last token and `next`: two neighbouring tokens or
 * comments in that span at least two lines apart. A comment between two blank lines still counts as padded.
 */
export function hasPaddingLine(
  prev: TSESTree.Node,
  next: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
  let token: TSESTree.Token | null = actualLastToken(prev, sourceCode);

  if (next.loc.start.line - token.loc.end.line < PADDING_LINES) return false;

  while (token !== null && token.range[0] < next.range[0]) {
    const after: TSESTree.Token | null = sourceCode.getTokenAfter(token, { includeComments: true });

    if (after !== null && after.loc.start.line - token.loc.end.line >= PADDING_LINES) return true;
    token = after;
  }

  return false;
}
