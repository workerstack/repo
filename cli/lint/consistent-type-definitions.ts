/**
 * Ported from typescript-eslint (MIT, see typescript-eslint.LICENSE): `consistent-type-definitions`. It differs in
 * three ways: an interface that may augment (in `declare module`, `declare global`, or a global script) is left alone,
 * `extends` types come before the body, and the fix ends the type with a semicolon.
 */
import { AST_NODE_TYPES } from "@typescript-eslint/types";
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

import { INTERFACE_KEYWORD, MODULE_STATEMENTS } from "./consistent-type-definitions.constants.ts";
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

/** Fails an interface that could be a type; one that may augment a module or the globals is left alone. */
export const consistentTypeDefinitions: RepoRule<"useType"> = {
  create(context) {
    const { sourceCode } = context;

    return {
      TSInterfaceDeclaration(node) {
        if (isInAmbientBlock(node) || !isModule(sourceCode.ast)) return;
        const isFixable = node.parent.type !== AST_NODE_TYPES.ExportDefaultDeclaration;

        context.report({
          fix: isFixable ? fixOf(sourceCode, node) : null,
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
