import type { ESTree } from "@oxlint/plugins";

import { NAMING_SYNTAX as SYNTAX } from "./naming-syntax.constants.ts";
import { get, nodesOf } from "./public-surface.syntax.ts";

type Node = ESTree.Node;
type Binding = ESTree.BindingPattern | ESTree.BindingRestElement;

const FUNCTIONS: readonly string[] = ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"];
const JSX: readonly string[] = ["JSXElement", "JSXFragment"];
const COMPARISONS: readonly string[] = ["===", "!==", "==", "!=", "<", ">", "<=", ">=", "instanceof", "in"];
const BOOLEAN_PARTS: readonly string[] = ["TSBooleanKeyword", "TSUndefinedKeyword", "TSNullKeyword"];
/** A file whose functions may return JSX, so a component in it may be PascalCase. */
const JSX_FILE = /\.[jt]sx$/;

/** Whether `node` is declared by an `export` statement. */
export function isExportStatement(node: Node): boolean {
  const type = node.parent?.type;
  return type === "ExportNamedDeclaration" || type === "ExportDefaultDeclaration";
}

/** Whether `node` is a statement of the module itself, or the declaration of an `export` statement that is. */
export function isModuleLevel(node: Node): boolean {
  const holder = isExportStatement(node) ? node.parent?.parent : node.parent;
  return holder?.type === "Program";
}

/** The local names `export { a, b as c }` statements of `program` export: a, b. */
export function exportedLocals(program: ESTree.Program): Set<string> {
  const specifiers = program.body.flatMap((statement) =>
    statement.type === "ExportNamedDeclaration" && statement.source === null ? statement.specifiers : [],
  );
  return new Set(specifiers.flatMap(({ local }) => (local.type === "Identifier" ? [local.name] : [])));
}

/** Whether `node` is under a `declare`: an external shape the code does not name. */
export function isAmbient(node: Node): boolean {
  for (let at: unknown = node; at !== null && at !== undefined; at = get(at, SYNTAX.parent))
    if (get(at, "declare") === true || get(at, "kind") === SYNTAX.global) return true;

  return false;
}

/** `expression` without the `as`, `satisfies` and `!` around it. */
function unwrap(expression: ESTree.Expression | null): ESTree.Expression | null {
  if (expression === null) return null;
  const { type } = expression;
  if (type === "TSAsExpression" || type === "TSSatisfiesExpression" || type === "TSNonNullExpression")
    return unwrap(expression.expression);
  return expression;
}

/** Whether `init` is a primitive or regex literal: `"x"`, `1`, `-1`, `true`, `/a/`, or a template with no `${}`. */
export function isLiteral(init: ESTree.Expression | null): boolean {
  const value = unwrap(init);
  if (value === null) return false;
  if (value.type === "Literal") return true;
  if (value.type === "TemplateLiteral") return value.expressions.length === 0;
  return value.type === "UnaryExpression" && value.operator === "-" && value.argument.type === "Literal";
}

function isBooleanType(type: ESTree.TSType): boolean {
  if (type.type === "TSBooleanKeyword") return true;
  return (
    type.type === "TSUnionType" &&
    type.types.some(isBooleanType) &&
    type.types.every((part) => BOOLEAN_PARTS.includes(part.type))
  );
}

/** Whether `declarator` holds a boolean by its annotation, or by a `true`/`false`, `!x` or comparison initializer. */
export function holdsBoolean(declarator: ESTree.VariableDeclarator): boolean {
  const annotation = declarator.id.typeAnnotation?.typeAnnotation;
  if (annotation !== undefined) return isBooleanType(annotation);
  const init = unwrap(declarator.init);
  if (init === null) return false;
  if (init.type === "Literal") return typeof init.value === "boolean";
  if (init.type === "UnaryExpression") return init.operator === "!";
  return init.type === "BinaryExpression" && COMPARISONS.includes(init.operator);
}

/** Whether `value` is JSX, or a ternary or `&&` that gives JSX. */
function isJsx(value: unknown): boolean {
  const type = String(get(value, "type"));
  if (JSX.includes(type)) return true;
  if (type === SYNTAX.conditional) return isJsx(get(value, "consequent")) || isJsx(get(value, "alternate"));
  if (type === SYNTAX.logical) return isJsx(get(value, "right"));
  return type === SYNTAX.parenthesized && isJsx(get(value, "expression"));
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
export function isComponent(value: ESTree.Expression | ESTree.Function | null, filename: string): boolean {
  if (value === null || !JSX_FILE.test(filename)) return false;
  if (value.type === "ArrowFunctionExpression" && value.expression) return isJsx(value.body);
  return FUNCTIONS.includes(value.type) && returnsJsxUnder(get(value, "body"));
}

/** Whether `value` is a function or arrow expression. */
export function isFunctionValue(value: ESTree.Expression | null): boolean {
  return value !== null && (value.type === "ArrowFunctionExpression" || value.type === "FunctionExpression");
}

/** The identifiers a binding names by the code's choice: `{ a, b: c, ...d }` → c, d; a shorthand key names none. */
export function chosenIdentifiers(pattern: Binding | null): ESTree.BindingIdentifier[] {
  if (pattern === null) return [];
  if (pattern.type === "Identifier") return [pattern];
  if (pattern.type === "AssignmentPattern") return chosenIdentifiers(pattern.left);
  if (pattern.type === "RestElement") return chosenIdentifiers(pattern.argument);
  if (pattern.type === "ArrayPattern") return pattern.elements.flatMap(chosenIdentifiers);
  return pattern.properties.flatMap((property) => {
    if (property.type === "RestElement") return chosenIdentifiers(property);
    return property.shorthand ? [] : chosenIdentifiers(property.value);
  });
}
