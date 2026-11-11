import type { CreateRule, ESTree } from "@oxlint/plugins";

import {
  isBooleanName,
  isCamel,
  isPascal,
  isUpperSnake,
  toBooleanName,
  toCamel,
  toPascal,
  toUpperSnake,
} from "./naming-cases.ts";
import {
  chosenIdentifiers,
  exportedLocals,
  holdsBoolean,
  isAmbient,
  isComponent,
  isExportStatement,
  isFunctionValue,
  isLiteral,
  isModuleLevel,
} from "./naming-kinds.ts";

type Node = ESTree.Node;
type Func = ESTree.Function | ESTree.ArrowFunctionExpression;
type Declaration = ESTree.VariableDeclaration;
type Declarator = ESTree.VariableDeclarator;
type Named = ESTree.Class | ESTree.TSInterfaceDeclaration | ESTree.TSTypeAliasDeclaration | ESTree.TSEnumDeclaration;
/** What a check of one file needs: its name, the locals an `export { … }` names, and the report. */
type Check = { filename: string; exported: Set<string>; fail: (node: Node, message: string) => void };

/** The word a message names a PascalCase declaration by. */
const PASCAL_KINDS: Readonly<Record<string, string>> = {
  ClassDeclaration: "class",
  ClassExpression: "class",
  TSEnumDeclaration: "enum",
  TSInterfaceDeclaration: "interface",
  TSTypeAliasDeclaration: "type",
};

function camelMessage(name: string, kind: string): string {
  return `\`${name}\` is ${kind}; name it in camelCase: ${toCamel(name)}`;
}

function pascalMessage(kind: string, name: string): string {
  return `${kind} \`${name}\` is not PascalCase; name it ${toPascal(name)}`;
}

function isExported(check: Check, node: Node, name: string): boolean {
  return isModuleLevel(node) && (isExportStatement(node) || check.exported.has(name));
}

/** The kind a camelCase message names a variable by. */
function variableKind(declaration: Declaration, init: ESTree.Expression | null): string {
  if (isFunctionValue(init)) return "a function";
  if (!isModuleLevel(declaration)) return "a local";
  return declaration.kind === "const" ? "a module-level const" : "a module-level variable";
}

/** The fault of a module-level const's name, or undefined when the other checks decide: literals are UPPER_SNAKE. */
function moduleConstFault(declarator: Declarator, name: string): string | null | undefined {
  if (isLiteral(declarator.init))
    return isUpperSnake(name) ? null : `\`${name}\` is a module-level literal const; name it ${toUpperSnake(name)}`;
  return isUpperSnake(name) ? null : undefined;
}

/** The fault of a local's or module variable's name: a boolean starts is/has/can/should/was, any other is camelCase. */
function localFault(declaration: Declaration, declarator: Declarator, name: string): string | null {
  if (holdsBoolean(declarator) && !isBooleanName(name))
    return `\`${name}\` holds a boolean; name it with is/has/can/should/was, like ${toBooleanName(name)}`;
  return isCamel(name) ? null : camelMessage(name, variableKind(declaration, declarator.init));
}

/** The fault of an export's name: camelCase, UPPER_SNAKE and a component's PascalCase pass. */
function exportFault(name: string, { isComponentName }: { isComponentName: boolean }): string | null {
  return isCamel(name) || isUpperSnake(name) || isComponentName ? null : camelMessage(name, "an export");
}

/** The fault in a variable's name, or null: exports, module consts, components, booleans, then camelCase. */
function variableFault(check: Check, declaration: Declaration, declarator: Declarator): string | null {
  if (declarator.id.type !== "Identifier") return null;
  const { name } = declarator.id;
  const isComponentName = isPascal(name) && isComponent(declarator.init, check.filename);
  if (isExported(check, declaration, name)) return exportFault(name, { isComponentName });
  const moduleFault =
    isModuleLevel(declaration) && declaration.kind === "const" ? moduleConstFault(declarator, name) : undefined;
  if (moduleFault !== undefined) return moduleFault;
  return isComponentName ? null : localFault(declaration, declarator, name);
}

/** Whether `name` is camelCase or led by `_`, the marker of a binding left unused on purpose. */
function isCamelOrUnused(name: string): boolean {
  return name.startsWith("_") || isCamel(name);
}

/** Checks the names a destructuring binds by the code's choice; their values are not known, so only casing. */
function checkPattern(check: Check, declaration: Declaration, pattern: ESTree.BindingPattern): void {
  const kind = variableKind(declaration, null);
  for (const id of chosenIdentifiers(pattern))
    if (!isCamelOrUnused(id.name)) check.fail(id, camelMessage(id.name, kind));
}

function checkDeclaration(check: Check, declaration: Declaration): void {
  if (isAmbient(declaration)) return;
  for (const declarator of declaration.declarations) {
    const fault = variableFault(check, declaration, declarator);
    if (fault !== null) check.fail(declarator.id, fault);
    if (declarator.id.type !== "Identifier") checkPattern(check, declaration, declarator.id);
  }
}

function checkParams(check: Check, node: Func): void {
  for (const param of node.params) {
    if (param.type === "TSParameterProperty") continue;
    const identifiers = param.type === "RestElement" ? chosenIdentifiers(param.argument) : chosenIdentifiers(param);
    for (const id of identifiers) if (!isCamelOrUnused(id.name)) check.fail(id, camelMessage(id.name, "a parameter"));
  }
}

function checkFunctionName(check: Check, node: ESTree.Function): void {
  if (node.id === null || isAmbient(node)) return;
  const { name } = node.id;
  const exported = isExported(check, node, name);
  const isComponentName = isPascal(name) && isComponent(node, check.filename);
  if (isCamel(name) || (exported && isUpperSnake(name)) || isComponentName) return;
  check.fail(node.id, camelMessage(name, exported ? "an export" : "a function"));
}

function checkPascal(check: Check, node: Named | ESTree.TSEnumMember): void {
  if (node.type === "TSEnumMember") {
    const { id } = node;
    if (id.type === "Identifier" && !isPascal(id.name)) check.fail(id, pascalMessage("enum member", id.name));
    return;
  }
  if (node.id !== null && !isPascal(node.id.name) && !isAmbient(node))
    check.fail(node.id, pascalMessage(PASCAL_KINDS[node.type] ?? "type", node.id.name));
}

/**
 * Fails a name whose casing hides what it holds: variables, functions and parameters are camelCase; classes, types,
 * interfaces, enums and enum members PascalCase; a module-level literal const that is not exported UPPER_SNAKE; and a
 * boolean variable starts is/has/can/should/was. Any module const may be UPPER_SNAKE, an export camelCase or
 * UPPER_SNAKE, and a `.tsx`/`.jsx` component PascalCase. Imports, shorthand bindings, keys, members, type parameters,
 * `declare`d shapes, and `_`-led parameters and destructured bindings pass. oxlint gives a rule no types, so a
 * boolean is known by its annotation or initializer only.
 */
export const namingConvention: CreateRule = {
  create(context) {
    const check: Check = {
      exported: new Set(),
      fail: (node, message) => context.report({ message, node }),
      filename: context.filename,
    };
    function pascal(node: Named | ESTree.TSEnumMember): void {
      checkPascal(check, node);
    }
    return {
      ArrowFunctionExpression: (node) => checkParams(check, node),
      ClassDeclaration: pascal,
      ClassExpression: pascal,
      FunctionDeclaration(node) {
        checkParams(check, node);
        checkFunctionName(check, node);
      },
      FunctionExpression: (node) => checkParams(check, node),
      Program(program) {
        check.exported = exportedLocals(program);
      },
      TSEnumDeclaration: pascal,
      TSEnumMember: pascal,
      TSInterfaceDeclaration: pascal,
      TSTypeAliasDeclaration: pascal,
      VariableDeclaration: (declaration) => checkDeclaration(check, declaration),
    };
  },
};
