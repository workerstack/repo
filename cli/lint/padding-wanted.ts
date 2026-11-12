/**
 * Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/require-readable-spacing.ts`, its policy over
 * eslint-stylistic's `padding-line-between-statements` statement kinds (MIT, see eslint-stylistic.LICENSE).
 */
import { AST_NODE_TYPES, ESLintUtils, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { isBlockLikeStatement } from "./is-block-like-statement.ts";
import {
  BINDING_KEYWORDS,
  CONTROL_KINDS,
  DECLARATION_KINDS,
  IMPORT_KIND,
  OVERLOAD_FOLLOWERS,
  USING_KINDS,
} from "./readable-spacing.constants.ts";

type Source = Readonly<TSESLint.SourceCode>;

/** Whether `node` is one of `kinds`: its type is a key, and its first token is that key's keyword when it has one. */
function isKind(
  node: TSESTree.Node,
  kinds: Partial<Record<AST_NODE_TYPES, string | null>>,
  sourceCode: Source,
): boolean {
  const keyword = kinds[node.type];

  if (keyword === undefined) return false;

  return keyword === null || sourceCode.getFirstToken(node)?.value === keyword;
}

function isSingleLine(node: TSESTree.Node): boolean {
  return node.loc.start.line === node.loc.end.line;
}

/** The declaration `node` exports, or `node` itself when it is no named export. */
function unexported(node: TSESTree.Node): TSESTree.Node | null {
  return node.type === AST_NODE_TYPES.ExportNamedDeclaration ? node.declaration : node;
}

/** A `const`, `let`, `var` or `using` declaration over several lines; an exported one does not count. */
function isMultilineBinding(node: TSESTree.Node, sourceCode: Source): boolean {
  if (node.type !== AST_NODE_TYPES.VariableDeclaration || isSingleLine(node)) return false;

  const first = ESLintUtils.nullThrows(
    sourceCode.getFirstToken(node),
    ESLintUtils.NullThrowsReasons.MissingToken("first token", node.type),
  );

  return USING_KINDS.includes(node.kind) || BINDING_KEYWORDS.includes(first.value);
}

/** A `const`, `let`, `var` or `using` declaration, optionally exported, written on one line. */
function isSinglelineBinding(node: TSESTree.Node): boolean {
  return unexported(node)?.type === AST_NODE_TYPES.VariableDeclaration && isSingleLine(node);
}

/** Comments above a statement belong to it; a comment trailing the previous line does not. */
function hasLeadingComment(node: TSESTree.Node, sourceCode: Source): boolean {
  const previousLine = sourceCode.getTokenBefore(node)?.loc.end.line;

  return sourceCode.getCommentsBefore(node).some((comment) => comment.loc.start.line !== previousLine);
}

/** A direct child of the program other than an import. */
function isModuleStatement(node: TSESTree.Node): boolean {
  return node.parent?.type === AST_NODE_TYPES.Program && node.type !== AST_NODE_TYPES.ImportDeclaration;
}

/** An overload signature, optionally exported, followed by another or by the implementation. */
function isOverloadPair(prev: TSESTree.Node, next: TSESTree.Node): boolean {
  const followed = unexported(next);

  return (
    unexported(prev)?.type === AST_NODE_TYPES.TSDeclareFunction &&
    followed !== null &&
    OVERLOAD_FOLLOWERS.includes(followed.type)
  );
}

/** Two statements the policy keeps together whatever else they are. */
function staysGrouped(prev: TSESTree.Node, next: TSESTree.Node, sourceCode: Source): boolean {
  if (isOverloadPair(prev, next)) return true;

  if (isSinglelineBinding(prev) && isSinglelineBinding(next) && !hasLeadingComment(next, sourceCode)) return true;

  return isKind(prev, IMPORT_KIND, sourceCode) && isKind(next, IMPORT_KIND, sourceCode);
}

/** Whether `node` asks for a blank line on either side of it. */
function wantsPaddingAround(node: TSESTree.Node, sourceCode: Source): boolean {
  return isMultilineBinding(node, sourceCode) || isKind(node, DECLARATION_KINDS, sourceCode) || isModuleStatement(node);
}

/** `node`, or the statement a chain of labels on it labels. */
function labeled(node: TSESTree.Node): TSESTree.Node {
  let statement = node;

  while (statement.type === AST_NODE_TYPES.LabeledStatement) statement = statement.body;

  return statement;
}

/**
 * Whether the policy asks for a blank line between neighbouring statements `prevNode` and `nextNode`. It keeps
 * overloads, one-line bindings (a new comment-led one excepted) and imports grouped; otherwise it pads after a
 * block-like statement or an import, before a control statement, and around multiline bindings, declarations and
 * module-scope statements.
 */
export function paddingWanted(prevNode: TSESTree.Node, nextNode: TSESTree.Node, sourceCode: Source): boolean {
  const prev = labeled(prevNode);
  const next = labeled(nextNode);

  if (staysGrouped(prev, next, sourceCode)) return false;

  return (
    isBlockLikeStatement(prev, sourceCode) ||
    isKind(next, CONTROL_KINDS, sourceCode) ||
    wantsPaddingAround(prev, sourceCode) ||
    wantsPaddingAround(next, sourceCode) ||
    isKind(prev, IMPORT_KIND, sourceCode)
  );
}
