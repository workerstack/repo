/**
 * Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/require-readable-spacing.ts`, with the sibling walk,
 * report and fix of eslint-stylistic's `padding-line-between-statements` (MIT, see eslint-stylistic.LICENSE).
 */
import { AST_NODE_TYPES, ESLintUtils, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { actualLastToken } from "./actual-last-token.ts";
import { hasPaddingLine } from "./has-padding-line.ts";
import { paddingWanted } from "./padding-wanted.ts";
import { NEWLINE, STATEMENT_SUFFIXES, TWO_NEWLINES } from "./readable-spacing.constants.ts";
import type { RepoRule } from "./rule.types.ts";

type Source = Readonly<TSESLint.SourceCode>;

const MESSAGE = "Expected blank line before this statement.";

/** Whether `node` takes part in the sibling walk: what esquery's `:statement` matches, a switch case or an overload. */
function isPaired(node: TSESTree.Node): boolean {
  if (node.type === AST_NODE_TYPES.SwitchCase || node.type === AST_NODE_TYPES.TSDeclareFunction) return true;

  return STATEMENT_SUFFIXES.some((suffix) => node.type.endsWith(suffix));
}

/** Where a finding on `node` points: the node, cut to its first line when it spans several. */
function reportLoc(node: TSESTree.Node, sourceCode: Source): TSESTree.SourceLocation {
  const { start } = node.loc;

  if (start.line === node.loc.end.line) return node.loc;

  const line = ESLintUtils.nullThrows(sourceCode.lines[start.line - 1], `line ${start.line} of the source`);

  return { end: { column: line.length, line: start.line }, start };
}

/**
 * The token to insert the blank line after, past `prev`'s comments on its own last line, and the text: one newline,
 * or two when what follows starts on that same line.
 */
function insertion(prev: TSESTree.Node, next: TSESTree.Node, sourceCode: Source): [TSESTree.Token, string] {
  let last: TSESTree.Token = actualLastToken(prev, sourceCode);
  let after = sourceCode.getTokenAfter(last, { includeComments: true });

  while (after !== null && after.range[0] < next.range[0] && after.loc.start.line === last.loc.end.line) {
    last = after;
    after = sourceCode.getTokenAfter(last, { includeComments: true });
  }

  const following = after !== null && after.range[0] < next.range[0] ? after : next;

  return [last, following.loc.start.line === last.loc.end.line ? TWO_NEWLINES : NEWLINE];
}

/**
 * Asks for a blank line between neighbouring statements where anti-slop's readable-spacing policy does, and inserts
 * it: between logical groups, around declarations and multiline bindings, before control statements and after
 * blocks. A whitespace-only fix.
 */
export const requireReadableSpacing: RepoRule<"expectedBlankLine"> = {
  create(context) {
    const { sourceCode } = context;

    function check(statements: readonly TSESTree.Node[]): void {
      let prev: TSESTree.Node | null = null;

      for (const next of statements) {
        if (!isPaired(next)) continue;

        if (prev !== null && !hasPaddingLine(prev, next, sourceCode) && paddingWanted(prev, next, sourceCode)) {
          const [token, text] = insertion(prev, next, sourceCode);
          context.report({
            fix: (fixer) => fixer.insertTextAfter(token, text),
            loc: reportLoc(next, sourceCode),
            messageId: "expectedBlankLine",
          });
        }

        prev = next;
      }
    }

    return {
      BlockStatement: (node) => check(node.body),
      Program: (node) => check(node.body),
      StaticBlock: (node) => check(node.body),
      SwitchCase: (node) => check(node.consequent),
      SwitchStatement: (node) => check(node.cases),
      TSModuleBlock: (node) => check(node.body),
    };
  },
  defaultOptions: [],
  meta: {
    fixable: "whitespace",
    messages: { expectedBlankLine: MESSAGE },
    schema: [],
    type: "layout",
  },
};
