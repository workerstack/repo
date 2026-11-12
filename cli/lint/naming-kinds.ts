import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import { NAMING_SYNTAX as SYNTAX } from "./naming-syntax.constants.ts";
import { get, nameOf, nodesOf } from "./public-surface.syntax.ts";

type Node = TSESTree.Node;

const FUNCTIONS: readonly string[] = ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"];
const JSX: readonly string[] = ["JSXElement", "JSXFragment"];
const COMPARISONS: readonly string[] = ["===", "!==", "==", "!=", "<", ">", "<=", ">=", "instanceof", "in"];
const BOOLEAN_PARTS: readonly string[] = ["TSBooleanKeyword", "TSUndefinedKeyword", "TSNullKeyword"];

/** A file whose functions may return JSX, so a component in it may be PascalCase. */
const JSX_FILE = /\.[jt]sx$/;

/** Whether `node` is declared by an `export` statement. */
export function isExportStatement(node: Node): boolean {
  const type = node.parent?.type;

  return type === AST_NODE_TYPES.ExportNamedDeclaration || type === AST_NODE_TYPES.ExportDefaultDeclaration;
}

/** Whether `node` is a statement of the module itself, or the declaration of an `export` statement that is. */
export function isModuleLevel(node: Node): boolean {
  const holder = isExportStatement(node) ? node.parent?.parent : node.parent;

  return holder?.type === AST_NODE_TYPES.Program;
}

/** The local names `export { a, b as c }` statements of `program` export: a, b. */
export function exportedLocals(program: TSESTree.Program): Set<string> {
  const specifiers = program.body.flatMap((statement) =>
    statement.type === AST_NODE_TYPES.ExportNamedDeclaration && statement.source === null ? statement.specifiers : [],
  );

  // Without a `from`, a string literal local is a parse error, so each local is an identifier.
  return new Set(specifiers.map(({ local }) => nameOf(local)));
}

/** Whether `node` is under a `declare`: an external shape the code does not name. */
export function isAmbient(node: Node): boolean {
  for (let at: unknown = node; at !== null && at !== undefined; at = get(at, SYNTAX.parent))
    if (get(at, "declare") === true || get(at, "kind") === SYNTAX.global) return true;

  return false;
}

/** `expression` without the `as`, `satisfies` and `!` around it. */
function unwrap(expression: TSESTree.Expression | null): TSESTree.Expression | null {
  if (expression === null) return null;
  const { type } = expression;

  if (
    type === AST_NODE_TYPES.TSAsExpression ||
    type === AST_NODE_TYPES.TSSatisfiesExpression ||
    type === AST_NODE_TYPES.TSNonNullExpression
  )
    return unwrap(expression.expression);

  return expression;
}

/** Whether `init` is a primitive or regex literal: `"x"`, `1`, `-1`, `true`, `/a/`, or a template with no `${}`. */
export function isLiteral(init: TSESTree.Expression | null): boolean {
  const value = unwrap(init);

  if (value === null) return false;

  if (value.type === AST_NODE_TYPES.Literal) return true;

  if (value.type === AST_NODE_TYPES.TemplateLiteral) return value.expressions.length === 0;

  return (
    value.type === AST_NODE_TYPES.UnaryExpression &&
    value.operator === "-" &&
    value.argument.type === AST_NODE_TYPES.Literal
  );
}

function isBooleanType(type: TSESTree.TypeNode): boolean {
  if (type.type === AST_NODE_TYPES.TSBooleanKeyword) return true;

  return (
    type.type === AST_NODE_TYPES.TSUnionType &&
    type.types.some(isBooleanType) &&
    type.types.every((part) => BOOLEAN_PARTS.includes(part.type))
  );
}

/** Whether `declarator` holds a boolean by its annotation, or by a `true`/`false`, `!x` or comparison initializer. */
export function holdsBoolean(declarator: TSESTree.VariableDeclarator): boolean {
  const annotation = declarator.id.typeAnnotation?.typeAnnotation;

  if (annotation !== undefined) return isBooleanType(annotation);
  const init = unwrap(declarator.init);

  if (init === null) return false;

  if (init.type === AST_NODE_TYPES.Literal) return typeof init.value === "boolean";

  if (init.type === AST_NODE_TYPES.UnaryExpression) return init.operator === "!";

  return init.type === AST_NODE_TYPES.BinaryExpression && COMPARISONS.includes(init.operator);
}

/** Whether `value` is JSX, or a ternary or `&&` that gives JSX. */
function isJsx(value: unknown): boolean {
  const type = String(get(value, "type"));

  if (JSX.includes(type)) return true;

  if (type === SYNTAX.conditional) return isJsx(get(value, "consequent")) || isJsx(get(value, "alternate"));

  // oxlint hands a rule no parenthesis nodes: `(<div />)` is the JSX element itself.
  return type === SYNTAX.logical && isJsx(get(value, "right"));
}

/** Whether a `return` under `value`, outside any nested function, returns JSX. */
function returnsJsxUnder(value: unknown): boolean {
  return nodesOf(value).some((node) => {
    if (FUNCTIONS.includes(String(node["type"]))) return false;

    if (node["type"] === SYNTAX.return) return isJsx(node["argument"]);

    return Object.entries(node).some(([key, child]) => key !== SYNTAX.parent && returnsJsxUnder(child));
  });
}

/** Whether `value` is a function in a `.tsx` or `.jsx` file that returns JSX: a component, which may be PascalCase. */
export function isComponent(value: TSESTree.Expression | TSESTree.FunctionLike | null, filename: string): boolean {
  if (value === null || !JSX_FILE.test(filename)) return false;

  if (value.type === AST_NODE_TYPES.ArrowFunctionExpression && value.expression) return isJsx(value.body);

  return FUNCTIONS.includes(value.type) && returnsJsxUnder(get(value, "body"));
}

/** Whether `value` is a function or arrow expression. */
export function isFunctionValue(value: TSESTree.Expression | null): boolean {
  return (
    value !== null &&
    (value.type === AST_NODE_TYPES.ArrowFunctionExpression || value.type === AST_NODE_TYPES.FunctionExpression)
  );
}

/** The patterns of an object pattern that name by the code's choice: `{ a, b: c, ...d }` → c, ...d. */
function chosenProperties(pattern: TSESTree.ObjectPattern): Node[] {
  return pattern.properties.flatMap((property): Node[] => {
    if (property.type === AST_NODE_TYPES.RestElement) return [property];

    return property.shorthand ? [] : [property.value];
  });
}

/** The patterns nested one level inside `pattern`; a name or a hole (`[, a]`) nests none. */
function innerPatterns(pattern: Node | null): (Node | null)[] {
  if (pattern?.type === AST_NODE_TYPES.ObjectPattern) return chosenProperties(pattern);

  if (pattern?.type === AST_NODE_TYPES.AssignmentPattern) return [pattern.left];

  if (pattern?.type === AST_NODE_TYPES.RestElement) return [pattern.argument];

  return pattern?.type === AST_NODE_TYPES.ArrayPattern ? pattern.elements : [];
}

/**
 * The identifiers a binding names by the code's choice: `{ a, b: c, ...d }` → c, d; a shorthand key names none, nor
 * does a hole (`[, a]`).
 */
export function chosenIdentifiers(pattern: Node | null): TSESTree.Identifier[] {
  return pattern?.type === AST_NODE_TYPES.Identifier ? [pattern] : innerPatterns(pattern).flatMap(chosenIdentifiers);
}
