import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import { declarationOf, moveReport, type Statement } from "./names.ts";
import type { RepoRule } from "./rule.types.ts";

const MESSAGE = "a class file holds one class, its imports and its export";

/** The class a top-level statement declares, bare or exported, or null when it declares none. */
function classOf(statement: Statement): TSESTree.ClassDeclaration | null {
  const declaration = declarationOf(statement);
  return declaration?.type === AST_NODE_TYPES.ClassDeclaration ? declaration : null;
}

/** `export { C }` or `export default C`: the export of a class declared bare. */
function exportsClass(statement: Statement, name: string | null): boolean {
  if (statement.type === AST_NODE_TYPES.ExportDefaultDeclaration)
    return statement.declaration.type === AST_NODE_TYPES.Identifier && statement.declaration.name === name;
  if (statement.type !== AST_NODE_TYPES.ExportNamedDeclaration || statement.source !== null) return false;
  const [only, ...rest] = statement.specifiers;
  return only !== undefined && rest.length === 0 && only.local.name === name;
}

/**
 * Fails, in a file with a top-level class, every top-level statement but its imports, that class and its export: a
 * helper, a type or a second class goes to its own file, so a file declares functions or a class, never both.
 */
export const classFile: RepoRule<"move"> = {
  create(context) {
    return {
      Program(program) {
        const owner = program.body.find((statement) => classOf(statement) !== null);
        if (owner === undefined) return;
        const name = classOf(owner)?.id?.name ?? null;
        for (const statement of program.body) {
          if (
            statement === owner ||
            statement.type === AST_NODE_TYPES.ImportDeclaration ||
            exportsClass(statement, name)
          )
            continue;
          context.report(moveReport(statement));
        }
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { move: `${MESSAGE}; move {{moved}} to its own file` },
    schema: [],
    type: "problem",
  },
};
