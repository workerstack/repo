import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

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
import type { RepoRule } from "./rule.types.ts";

type Node = TSESTree.Node;

type Func = TSESTree.FunctionLike;

type Declaration = TSESTree.VariableDeclaration;

type Declarator = TSESTree.VariableDeclarator;

type Named =
  | TSESTree.ClassDeclaration
  | TSESTree.ClassExpression
  | TSESTree.TSInterfaceDeclaration
  | TSESTree.TSTypeAliasDeclaration
  | TSESTree.TSEnumDeclaration;

type MessageId = "boolean" | "camel" | "literal" | "pascal";

/** What is wrong with a name: which message, and the parts it fills in. */
type Fault = { messageId: MessageId; data: Record<string, string> };

/** What a check of one file needs: its name, the locals an `export { … }` names, and the report. */
type Check = { filename: string; exported: Set<string>; fail: (node: Node, fault: Fault) => void };

/** The word a message names a PascalCase declaration by, for each declaration type the check visits. */
const PASCAL_KINDS: Readonly<Record<Named["type"], string>> = {
  ClassDeclaration: "class",
  ClassExpression: "class",
  TSEnumDeclaration: "enum",
  TSInterfaceDeclaration: "interface",
  TSTypeAliasDeclaration: "type",
};

function camelFault(name: string, kind: string): Fault {
  return { data: { fix: toCamel(name), kind, name }, messageId: "camel" };
}

function pascalFault(kind: string, name: string): Fault {
  return { data: { fix: toPascal(name), kind, name }, messageId: "pascal" };
}

function isExported(check: Check, node: Node, name: string): boolean {
  return isModuleLevel(node) && (isExportStatement(node) || check.exported.has(name));
}

/** The kind a camelCase message names a variable by. */
function variableKind(declaration: Declaration, init: TSESTree.Expression | null): string {
  if (isFunctionValue(init)) return "a function";

  if (!isModuleLevel(declaration)) return "a local";

  return declaration.kind === "const" ? "a module-level const" : "a module-level variable";
}

/** The fault of a module-level const's name, or undefined when the other checks decide: literals are UPPER_SNAKE. */
function moduleConstFault(declarator: Declarator, name: string): Fault | null | undefined {
  if (isLiteral(declarator.init))
    return isUpperSnake(name) ? null : { data: { fix: toUpperSnake(name), name }, messageId: "literal" };

  return isUpperSnake(name) ? null : undefined;
}

/** The fault of a local's or module variable's name: a boolean starts is/has/can/should/was, any other is camelCase. */
function localFault(declaration: Declaration, declarator: Declarator, name: string): Fault | null {
  if (holdsBoolean(declarator) && !isBooleanName(name))
    return { data: { fix: toBooleanName(name), name }, messageId: "boolean" };

  return isCamel(name) ? null : camelFault(name, variableKind(declaration, declarator.init));
}

/** The fault of an export's name: camelCase, UPPER_SNAKE and a component's PascalCase pass. */
function exportFault(name: string, { isComponentName }: { isComponentName: boolean }): Fault | null {
  return isCamel(name) || isUpperSnake(name) || isComponentName ? null : camelFault(name, "an export");
}

/** The fault in a variable's name, or null: exports, module consts, components, booleans, then camelCase. */
function variableFault(check: Check, declaration: Declaration, declarator: Declarator): Fault | null {
  if (declarator.id.type !== AST_NODE_TYPES.Identifier) return null;
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
function checkPattern(check: Check, declaration: Declaration, pattern: TSESTree.BindingName): void {
  const kind = variableKind(declaration, null);

  for (const id of chosenIdentifiers(pattern)) if (!isCamelOrUnused(id.name)) check.fail(id, camelFault(id.name, kind));
}

function checkDeclaration(check: Check, declaration: Declaration): void {
  if (isAmbient(declaration)) return;

  for (const declarator of declaration.declarations) {
    const fault = variableFault(check, declaration, declarator);

    if (fault !== null) check.fail(declarator.id, fault);

    if (declarator.id.type !== AST_NODE_TYPES.Identifier) checkPattern(check, declaration, declarator.id);
  }
}

function checkParams(check: Check, node: Func): void {
  for (const param of node.params) {
    if (param.type === AST_NODE_TYPES.TSParameterProperty) continue;

    const identifiers =
      param.type === AST_NODE_TYPES.RestElement ? chosenIdentifiers(param.argument) : chosenIdentifiers(param);

    for (const id of identifiers) if (!isCamelOrUnused(id.name)) check.fail(id, camelFault(id.name, "a parameter"));
  }
}

function checkFunctionName(check: Check, node: TSESTree.FunctionDeclaration): void {
  if (node.id === null || isAmbient(node)) return;
  const { name } = node.id;
  const exported = isExported(check, node, name);
  const isComponentName = isPascal(name) && isComponent(node, check.filename);

  if (isCamel(name) || (exported && isUpperSnake(name)) || isComponentName) return;
  check.fail(node.id, camelFault(name, exported ? "an export" : "a function"));
}

function checkPascal(check: Check, node: Named | TSESTree.TSEnumMember): void {
  if (node.type === AST_NODE_TYPES.TSEnumMember) {
    const { id } = node;

    if (id.type === AST_NODE_TYPES.Identifier && !isPascal(id.name))
      check.fail(id, pascalFault("enum member", id.name));

    return;
  }

  if (node.id !== null && !isPascal(node.id.name) && !isAmbient(node))
    check.fail(node.id, pascalFault(PASCAL_KINDS[node.type], node.id.name));
}

/**
 * Fails a name whose casing hides what it holds: variables, functions and parameters are camelCase; classes, types,
 * interfaces, enums and enum members PascalCase; a module-level literal const that is not exported UPPER_SNAKE; and a
 * boolean variable starts is/has/can/should/was. Any module const may be UPPER_SNAKE, an export camelCase or
 * UPPER_SNAKE, and a `.tsx`/`.jsx` component PascalCase. Imports, shorthand bindings, keys, members, type parameters,
 * `declare`d shapes, and `_`-led parameters and destructured bindings pass. oxlint gives a rule no types, so a
 * boolean is known by its annotation or initializer only.
 */
export const namingConvention: RepoRule<MessageId> = {
  create(context) {
    const check: Check = {
      exported: new Set(),
      fail: (node, fault) => context.report({ ...fault, node }),
      filename: context.filename,
    };

    function pascal(node: Named | TSESTree.TSEnumMember): void {
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
  defaultOptions: [],
  meta: {
    messages: {
      boolean: "`{{name}}` holds a boolean; name it with is/has/can/should/was, like {{fix}}",
      camel: "`{{name}}` is {{kind}}; name it in camelCase: {{fix}}",
      literal: "`{{name}}` is a module-level literal const; name it {{fix}}",
      pascal: "{{kind}} `{{name}}` is not PascalCase; name it {{fix}}",
    },
    schema: [],
    type: "suggestion",
  },
};
