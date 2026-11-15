/**
 * Numbers that name nothing: a literal passes as the value of a `const` (directly, or in its array, object or
 * arithmetic), of an enum member or of a `readonly` class property; else only 0 and 1, the identity values, and a 2
 * that scales. A schema bound, an argument of `.max(…)` and its kin on a value with a `parse` method, must be a
 * constant imported from a constants file or package.
 */
import { ModifierFlags, SyntaxKind } from "typescript/unstable/ast";
import type {
  CallExpression,
  Expression,
  Identifier,
  Node,
  NumericLiteral,
  PropertyAccessExpression,
  SourceFile,
} from "typescript/unstable/ast";
import {
  isBinaryExpression,
  isCallExpression,
  isEnumMember,
  isIdentifier,
  isImportDeclaration,
  isLiteralTypeNode,
  isNumericLiteral,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isPropertyDeclaration,
  isStringLiteral,
  isVariableDeclaration,
} from "typescript/unstable/ast/is";
import type { Project } from "typescript/unstable/async";

import { MAGIC_NUMBER } from "../script-rules.ts";
import { ancestorOf, modifierFlagsOf } from "../ts-nodes.ts";
import type { MagicHit } from "./magic-hit.ts";
import { hitAt, isConstantsModule, isConstDeclaration } from "./magic-nodes.ts";

const SCHEMA_BOUNDS = ["min", "max", "length", "gt", "gte", "lt", "lte", "multipleOf", "size"];

/** A schema is a value with this method. */
const PARSE = "parse";
const IDENTITIES = [0, 1];
const SCALE = 2;

const SCALING = [
  SyntaxKind.AsteriskToken,
  SyntaxKind.SlashToken,
  SyntaxKind.PercentToken,
  SyntaxKind.AsteriskAsteriskToken,
];

const ARITHMETIC = [...SCALING, SyntaxKind.PlusToken, SyntaxKind.MinusToken];

/** What a literal sits in and still names what the const, enum member or readonly field around it names. */
const CONTAINERS = [
  SyntaxKind.ParenthesizedExpression,
  SyntaxKind.AsExpression,
  SyntaxKind.SatisfiesExpression,
  SyntaxKind.ArrayLiteralExpression,
  SyntaxKind.ObjectLiteralExpression,
  SyntaxKind.PropertyAssignment,
  SyntaxKind.PrefixUnaryExpression,
];

/** A call that has a schema bound's shape, like `max` in `z.string().max(2048)`, before its receiver is typed. */
type BoundCall = CallExpression & { expression: PropertyAccessExpression };

function namesNothing(text: string) {
  return `${text} names nothing; give it a named const`;
}

function bound(method: string, arg: Node) {
  return `.${method}(${arg.getText()}) is a schema bound; import it from a *.constants.ts file or a constants package`;
}

function isArithmetic(node: Node) {
  return isBinaryExpression(node) && ARITHMETIC.includes(node.operatorToken.kind);
}

function isScaling(node: Node) {
  return isBinaryExpression(node) && SCALING.includes(node.operatorToken.kind);
}

/** The literal with its minus: `-1` is one value. */
function unitOf(literal: NumericLiteral): Expression {
  const { parent } = literal;

  return isPrefixUnaryExpression(parent) && parent.operator === SyntaxKind.MinusToken ? parent : literal;
}

/** Whether `unit`, climbed through its containers, is what a `const`, an enum member or a readonly field holds. */
function isNamed(unit: Node): boolean {
  let node = unit;

  while (CONTAINERS.includes(node.parent.kind) || isArithmetic(node.parent)) node = node.parent;
  const holder = node.parent;

  if (isVariableDeclaration(holder)) return isConstDeclaration(holder);

  if (isPropertyDeclaration(holder)) return (modifierFlagsOf(holder) & ModifierFlags.Readonly) !== 0;

  return isEnumMember(holder);
}

/** Whether `node` is a call named like a schema bound, whatever its receiver. */
function isBoundCall(node: Node): node is BoundCall {
  return (
    isCallExpression(node) &&
    isPropertyAccessExpression(node.expression) &&
    SCHEMA_BOUNDS.includes(node.expression.name.text)
  );
}

/** The bound-shaped calls whose receiver has a `parse` method: the schema bounds. */
async function schemaBounds(calls: readonly BoundCall[], project: Project): Promise<BoundCall[]> {
  if (calls.length === 0) return [];
  const { checker } = project;
  const receivers = await checker.getTypeAtLocation(calls.map((call) => call.expression.expression));
  const schemas: BoundCall[] = [];

  for (const [index, call] of calls.entries()) {
    const receiver = receivers[index];

    if (receiver !== undefined && (await checker.getPropertyOfType(receiver, PARSE)) !== undefined) schemas.push(call);
  }

  return schemas;
}

/** The hit a literal makes, given the method of each schema bound call; null for a literal that names something. */
function numberHit(literal: NumericLiteral, methods: ReadonlyMap<Node, string>): MagicHit | null {
  const unit = unitOf(literal);

  if (isLiteralTypeNode(unit.parent)) return null;
  const magnitude = Number(literal.text);
  const value = unit === literal ? magnitude : -magnitude;

  if (IDENTITIES.includes(value)) return null;

  if (value === SCALE && unit === literal && isScaling(unit.parent)) return null;
  const method = methods.get(unit.parent);

  if (method !== undefined) return hitAt(unit, MAGIC_NUMBER, bound(method, unit));

  return isNamed(unit) ? null : hitAt(unit, MAGIC_NUMBER, namesNothing(unit.getText()));
}

/** The identifier a bound argument starts from, as `LIMITS` in `LIMITS.name.max`; null for anything computed. */
function rootOf(arg: Expression): Identifier | null {
  let root = arg;

  while (isPropertyAccessExpression(root)) root = root.expression;

  return isIdentifier(root) ? root : null;
}

/**
 * Whether a bound argument's root names a local `const` or an import from a module that is not a constants file or
 * package, given its symbol's first declaration; a parameter, a `let` or anything computed passes, being no fixed
 * number.
 */
function isLocalBound(declaration: Node | undefined): boolean {
  if (declaration === undefined) return false;
  const imported = ancestorOf(declaration, isImportDeclaration);

  if (imported === undefined) return isVariableDeclaration(declaration) && isConstDeclaration(declaration);

  // An import that parses names its module in a string literal.
  return isStringLiteral(imported.moduleSpecifier) && !isConstantsModule(imported.moduleSpecifier.text);
}

/** The hits at the schema bounds' arguments that name a local or non-constants value. */
async function boundHits(schemas: readonly BoundCall[], project: Project): Promise<MagicHit[]> {
  const named = schemas.flatMap((call) =>
    call.arguments.flatMap((arg) => {
      const root = rootOf(arg);

      return root === null ? [] : [{ arg, method: call.expression.name.text, root }];
    }),
  );

  if (named.length === 0) return [];
  const symbols = await project.checker.getSymbolAtLocation(named.map(({ root }) => root));
  const hits: MagicHit[] = [];

  for (const [index, { arg, method }] of named.entries()) {
    const handle = symbols[index]?.declarations[0];

    if (isLocalBound(await handle?.resolve(project))) hits.push(hitAt(arg, MAGIC_NUMBER, bound(method, arg)));
  }

  return hits;
}

/** Every magic number of `file` and every schema bound not imported from a constants home. */
export async function magicNumbers(file: SourceFile, project: Project): Promise<MagicHit[]> {
  const literals: NumericLiteral[] = [];
  const calls: BoundCall[] = [];

  function visit(node: Node): void {
    if (isNumericLiteral(node)) literals.push(node);

    if (isBoundCall(node)) calls.push(node);
    node.forEachChild(visit);
  }

  visit(file);
  const schemas = await schemaBounds(calls, project);
  const methods = new Map<Node, string>(schemas.map((call) => [call, call.expression.name.text]));
  const numbers = literals.map((literal) => numberHit(literal, methods)).filter((hit) => hit !== null);

  return [...numbers, ...(await boundHits(schemas, project))];
}
