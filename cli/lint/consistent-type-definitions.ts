/**
 * Ported from typescript-eslint (MIT, see typescript-eslint.LICENSE): `consistent-type-definitions`. It differs in
 * four ways: an interface that may augment (in `declare module`, `declare global`, or a global script) is left alone,
 * so is one that merges with another declaration of its name (a class, a function, a namespace or another
 * interface), `extends` types come before the body, and the fix ends the type with a semicolon. An exported
 * interface is reported but not fixed: another module may augment it (`declare module`), which one file cannot show.
 */
import { AST_NODE_TYPES } from "@typescript-eslint/types";
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

import { INTERFACE_KEYWORD, MERGING_DECLARATIONS, MODULE_STATEMENTS } from "./consistent-type-definitions.constants.ts";
import { nullThrows } from "./null-throws.ts";
import type { RepoRule } from "./rule.types.ts";

const MESSAGE = "Use `type` instead of `interface`.";

/** Whether `node` sits inside a `declare` module, namespace or global block, where an interface may augment. */
function isInAmbientBlock(node: TSESTree.Node): boolean {
  for (let current = node.parent; current != null; current = current.parent)
    if (current.type === AST_NODE_TYPES.TSModuleDeclaration && current.declare) return true;

  return false;
}

/** Whether `program` is a module: it imports or exports. */
function isModule(program: TSESTree.Program): boolean {
  return program.body.some((statement) => MODULE_STATEMENTS.includes(statement.type));
}

/** A declaration an interface of the same name merges with. */
type Mergeable =
  | TSESTree.ClassDeclaration
  | TSESTree.FunctionDeclaration
  | TSESTree.TSInterfaceDeclaration
  | TSESTree.TSModuleDeclaration;

/** Whether `node` is a declaration an interface of the same name merges with. */
function isMergeable(node: TSESTree.Node | null): node is Mergeable {
  return node !== null && MERGING_DECLARATIONS.includes(node.type);
}

/** The name `statement` declares when it is a declaration an interface can merge with, unwrapping an export. */
function mergeableName(statement: TSESTree.Node): string | null {
  const declaration =
    statement.type === AST_NODE_TYPES.ExportNamedDeclaration ||
    statement.type === AST_NODE_TYPES.ExportDefaultDeclaration
      ? statement.declaration
      : statement;

  if (!isMergeable(declaration)) return null;

  return declaration.id?.type === AST_NODE_TYPES.Identifier ? declaration.id.name : null;
}

/** The statements of the list that holds `statement`: a program, a module block or a block; none in a switch case. */
function siblingsOf(statement: TSESTree.Node): readonly TSESTree.Node[] {
  const list = statement.parent;

  return list?.type === AST_NODE_TYPES.Program ||
    list?.type === AST_NODE_TYPES.TSModuleBlock ||
    list?.type === AST_NODE_TYPES.BlockStatement
    ? list.body
    : [];
}

/**
 * Whether another declaration in the statement list that holds `node` has its name: the two merge, and a type alias
 * cannot, so the rewrite would be a duplicate identifier and drop the merged members.
 */
function mergesWithAnother(node: TSESTree.TSInterfaceDeclaration): boolean {
  const statement = node.parent.type === AST_NODE_TYPES.ExportNamedDeclaration ? node.parent : node;

  return siblingsOf(statement).some((other) => other !== statement && mergeableName(other) === node.id.name);
}

/**
 * Whether the module exports `node`, in its declaration, by an `export { … }` list or as its default: then another
 * module can augment it.
 */
function isExported(node: TSESTree.TSInterfaceDeclaration, program: TSESTree.Program): boolean {
  if (
    node.parent.type === AST_NODE_TYPES.ExportNamedDeclaration ||
    node.parent.type === AST_NODE_TYPES.ExportDefaultDeclaration
  )
    return true;
  const name = node.id.name;

  return program.body.some((statement) => {
    if (statement.type === AST_NODE_TYPES.ExportDefaultDeclaration)
      return statement.declaration.type === AST_NODE_TYPES.Identifier && statement.declaration.name === name;

    return (
      statement.type === AST_NODE_TYPES.ExportNamedDeclaration &&
      statement.source === null &&
      statement.specifiers.some((specifier) => specifier.local.name === name)
    );
  });
}

/** The fixes that turn `node` into `type Name<T> = A & B & { … };`, keeping `export` and `declare`. */
function fixOf(
  sourceCode: Readonly<TSESLint.SourceCode>,
  node: TSESTree.TSInterfaceDeclaration,
): TSESLint.ReportFixFunction {
  return (fixer) => {
    const keyword = nullThrows(
      sourceCode.getFirstToken(node, { filter: (token) => token.value === INTERFACE_KEYWORD }),
      "an interface declaration has an interface keyword",
    );

    const head = (node.typeParameters ?? node.id).range[1];
    const heritage = node.extends.map((parent) => `${sourceCode.getText(parent)} & `).join("");

    return [
      fixer.replaceText(keyword, "type"),
      fixer.replaceTextRange([head, node.body.range[0]], ` = ${heritage}`),
      fixer.insertTextAfter(node.body, ";"),
    ];
  };
}

/**
 * Fails an interface that could be a type; one that may augment a module or the globals, or that merges with another
 * declaration of its name, is left alone, and an exported one is not fixed.
 */
export const consistentTypeDefinitions: RepoRule<"useType"> = {
  create(context) {
    const { sourceCode } = context;

    return {
      TSInterfaceDeclaration(node) {
        if (isInAmbientBlock(node) || !isModule(sourceCode.ast) || mergesWithAnother(node)) return;
        context.report({
          fix: isExported(node, sourceCode.ast) ? null : fixOf(sourceCode, node),
          messageId: "useType",
          node: node.id,
        });
      },
    };
  },
  defaultOptions: [],
  meta: {
    fixable: "code",
    messages: { useType: MESSAGE },
    schema: [],
    type: "suggestion",
  },
};
