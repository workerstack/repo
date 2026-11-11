/**
 * Regexes built inside a function: a regex literal, or `RegExp(…)` and `new RegExp(…)` of a literal pattern. Each
 * runs its compile on every call and hides what it matches; a named module const or a constants export says both.
 * A file named `*.constants.ts` passes.
 */
import ts from "typescript";

import { MAGIC_REGEX } from "../lint/script-rules.ts";
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
function isLiteralRegExp(node: ts.Node): node is ts.CallExpression | ts.NewExpression {
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return false;
  const [first] = node.arguments ?? [];
  if (!ts.isIdentifier(node.expression) || node.expression.text !== REGEXP_NAME) return false;
  return first !== undefined && ts.isStringLiteralLike(first);
}

/** Every regex of `file` built inside a function; none for a constants file. */
export function magicRegexes(file: ts.SourceFile): MagicHit[] {
  if (CONSTANTS_FILE.test(file.fileName)) return [];
  const hits: MagicHit[] = [];
  function visit(node: ts.Node, depth: number): void {
    if ((ts.isRegularExpressionLiteral(node) || isLiteralRegExp(node)) && depth > 0)
      hits.push(hitAt(node, MAGIC_REGEX, insideFunction(node.getText(file))));
    const inner = depth + Number(ts.isFunctionLike(node));
    ts.forEachChild(node, (child) => visit(child, inner));
  }
  visit(file, 0);
  return hits;
}
