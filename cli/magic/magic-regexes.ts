/**
 * Regexes built inside a function: a regex literal, or `RegExp(…)` and `new RegExp(…)` of a literal pattern. Each
 * runs its compile on every call and hides what it matches; a named module const or a constants export says both.
 * A file named `*.constants.ts` passes.
 */
import type { CallExpression, NewExpression, Node, SourceFile } from "typescript/unstable/ast";
import {
  isCallExpression,
  isIdentifier,
  isNewExpression,
  isRegularExpressionLiteral,
  isSignatureDeclaration,
  isStringLiteralLikeNode,
} from "typescript/unstable/ast/is";

import { MAGIC_REGEX } from "../script-rules.ts";
import type { MagicHit } from "./magic-hit.ts";
import { CONSTANTS_FILE, hitAt } from "./magic-nodes.ts";
import { REGEXP_NAME } from "./regexp-name.constants.ts";

/** The message for a regex written as `text`. */
function insideFunction(text: string): string {
  return (
    `${text} is a regex inside a function; hoist it to a named module const or a *.constants.ts export ` +
    "(a /g or /y regex keeps lastIndex: use that const only with replace, replaceAll, matchAll or split)"
  );
}

/** Whether `node` is `RegExp("…")` or `new RegExp("…")` with a string-like literal first. */
function isLiteralRegExp(node: Node): node is CallExpression | NewExpression {
  if (!isCallExpression(node) && !isNewExpression(node)) return false;
  const [first] = node.arguments ?? [];

  if (!isIdentifier(node.expression) || node.expression.text !== REGEXP_NAME) return false;

  return first !== undefined && isStringLiteralLikeNode(first);
}

/** Every regex of `file` built inside a function; none for a constants file. */
export function magicRegexes(file: SourceFile): MagicHit[] {
  if (CONSTANTS_FILE.test(file.fileName)) return [];
  const hits: MagicHit[] = [];

  function visit(node: Node, depth: number): void {
    if ((isRegularExpressionLiteral(node) || isLiteralRegExp(node)) && depth > 0)
      hits.push(hitAt(node, MAGIC_REGEX, insideFunction(node.getText(file))));
    // typescript 5.9's isFunctionLike, but for the JSDoc kinds, which hold no code.
    const inner = depth + Number(isSignatureDeclaration(node));
    node.forEachChild((child) => visit(child, inner));
  }

  visit(file, 0);

  return hits;
}
