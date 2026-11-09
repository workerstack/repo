/** What both magic checks ask of a syntax node: a const's string, where a hit sits, and the constants homes. */
import ts from "typescript";
import type { MagicHit } from "./magic-hit.ts";

/** A `*.constants.ts` file (or its `.js`, `.mts`… spelling), as a path or an import specifier with or without one. */
export const CONSTANTS_FILE: RegExp = /\.constants(?:\.[cm]?[jt]sx?)?$/;
/** A package, scoped or not, whose name ends in `constants`, or a subpath of one. */
const CONSTANTS_PACKAGE = /^(?:@[^/]+\/)?[^/]*constants(?:\/|$)/;
/** A string with a letter or digit in it; one of punctuation or nothing says nothing a name could. */
const MEANINGFUL = /[\p{L}\p{N}]/u;

/** Whether an import of `specifier` reaches a constants file or a constants package. */
export const isConstantsModule = (specifier: string): boolean =>
  CONSTANTS_FILE.test(specifier) || CONSTANTS_PACKAGE.test(specifier);

export const isConstDeclaration = (declaration: ts.VariableDeclaration): boolean =>
  (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0;

/** `node` without the parentheses, `as` and `satisfies` around it, which change a type and never a value. */
function unwrapped(node: ts.Expression): ts.Expression {
  let bare = node;
  while (ts.isParenthesizedExpression(bare) || ts.isAsExpression(bare) || ts.isSatisfiesExpression(bare))
    bare = bare.expression;
  return bare;
}

/** A string literal that says something: not empty and not punctuation alone. */
export const isMeaningful = (node: ts.Expression): node is ts.StringLiteralLike =>
  ts.isStringLiteralLike(node) && MEANINGFUL.test(node.text);

/** The string a `const` holds, when its initializer is a literal that says something; null for any other. */
export function constString(declaration: ts.VariableDeclaration): string | null {
  if (declaration.initializer === undefined || !isConstDeclaration(declaration)) return null;
  const value = unwrapped(declaration.initializer);
  return isMeaningful(value) ? value.text : null;
}

/** A hit reported at the start of `node`, with its one-based line and column. */
export function hitAt(node: ts.Node, rule: string, message: string): MagicHit {
  const file = node.getSourceFile();
  const at = node.getStart(file);
  const { line, character } = file.getLineAndCharacterOfPosition(at);
  return { fileName: file.fileName, at, line: line + 1, column: character + 1, rule, message };
}
