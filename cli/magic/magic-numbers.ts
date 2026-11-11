/**
 * Numbers that name nothing: a literal passes as the value of a `const` (directly, or in its array, object or
 * arithmetic), of an enum member or of a `readonly` class property; else only 0 and 1, the identity values, and a 2
 * that scales. A schema bound, an argument of `.max(…)` and its kin on a value with a `parse` method, must be a
 * constant imported from a constants file or package.
 */
import ts from "typescript";

import { MAGIC_NUMBER } from "../lint/script-rules.ts";
import type { MagicHit } from "./magic-hit.ts";
import { hitAt, isConstantsModule, isConstDeclaration } from "./magic-nodes.ts";

const SCHEMA_BOUNDS = ["min", "max", "length", "gt", "gte", "lt", "lte", "multipleOf", "size"];
/** A schema is a value with this method. */
const PARSE = "parse";
const IDENTITIES = [0, 1];
const SCALE = 2;
const SCALING = [
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
];
const ARITHMETIC = [...SCALING, ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken];
/** What a literal sits in and still names what the const, enum member or readonly field around it names. */
const CONTAINERS = [
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.SatisfiesExpression,
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.PrefixUnaryExpression,
];

const NAMES_NOTHING = (text: string) => `${text} names nothing; give it a named const`;
const BOUND = (method: string, arg: ts.Node) =>
  `.${method}(${arg.getText()}) is a schema bound; import it from a *.constants.ts file or a constants package`;

const isArithmetic = (node: ts.Node) => ts.isBinaryExpression(node) && ARITHMETIC.includes(node.operatorToken.kind);
const isScaling = (node: ts.Node) => ts.isBinaryExpression(node) && SCALING.includes(node.operatorToken.kind);

/** The literal with its minus: `-1` is one value. */
function unitOf(literal: ts.NumericLiteral): ts.Expression {
  const { parent } = literal;
  return ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.MinusToken ? parent : literal;
}

/** Whether `unit`, climbed through its containers, is what a `const`, an enum member or a readonly field holds. */
function isNamed(unit: ts.Node): boolean {
  let node = unit;
  while (CONTAINERS.includes(node.parent.kind) || isArithmetic(node.parent)) node = node.parent;
  const holder = node.parent;
  if (ts.isVariableDeclaration(holder)) return isConstDeclaration(holder);
  if (ts.isPropertyDeclaration(holder)) return (ts.getCombinedModifierFlags(holder) & ts.ModifierFlags.Readonly) !== 0;
  return ts.isEnumMember(holder);
}

/** The method of a schema-bound call `node` is, like `max` in `z.string().max(2048)`; null for any other node. */
function boundOf(node: ts.Node, checker: ts.TypeChecker): string | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const method = node.expression.name.text;
  if (!SCHEMA_BOUNDS.includes(method)) return null;
  const receiver = checker.getTypeAtLocation(node.expression.expression);
  return receiver.getProperty(PARSE) === undefined ? null : method;
}

function numberHit(literal: ts.NumericLiteral, checker: ts.TypeChecker): MagicHit | null {
  const unit = unitOf(literal);
  if (ts.isLiteralTypeNode(unit.parent)) return null;
  const magnitude = Number(literal.text);
  const value = unit === literal ? magnitude : -magnitude;
  if (IDENTITIES.includes(value)) return null;
  if (value === SCALE && unit === literal && isScaling(unit.parent)) return null;
  const method = boundOf(unit.parent, checker);
  if (method !== null) return hitAt(unit, MAGIC_NUMBER, BOUND(method, unit));
  return isNamed(unit) ? null : hitAt(unit, MAGIC_NUMBER, NAMES_NOTHING(unit.getText()));
}

/**
 * Whether a bound argument names a local `const` or an import from a module that is not a constants file or
 * package; a parameter, a `let` or anything computed passes, being no fixed number.
 */
function isLocalBound(arg: ts.Expression, checker: ts.TypeChecker): boolean {
  let root = arg;
  while (ts.isPropertyAccessExpression(root)) root = root.expression;
  if (!ts.isIdentifier(root)) return false;
  const declaration = checker.getSymbolAtLocation(root)?.declarations?.[0];
  if (declaration === undefined) return false;
  const imported = ts.findAncestor(declaration, ts.isImportDeclaration);
  if (imported === undefined) return ts.isVariableDeclaration(declaration) && isConstDeclaration(declaration);
  const specifier =
    imported.moduleSpecifier /* an import that parses names its module in a string literal */ as ts.StringLiteral;
  return !isConstantsModule(specifier.text);
}

function boundHits(call: ts.CallExpression, checker: ts.TypeChecker): MagicHit[] {
  const method = boundOf(call, checker);
  if (method === null) return [];
  return call.arguments
    .filter((arg) => isLocalBound(arg, checker))
    .map((arg) => hitAt(arg, MAGIC_NUMBER, BOUND(method, arg)));
}

/** Every magic number of `file` and every schema bound not imported from a constants home, in source order. */
export function magicNumbers(file: ts.SourceFile, checker: ts.TypeChecker): MagicHit[] {
  const hits: MagicHit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNumericLiteral(node)) {
      const found = numberHit(node, checker);
      if (found !== null) hits.push(found);
    }
    if (ts.isCallExpression(node)) hits.push(...boundHits(node, checker));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}
