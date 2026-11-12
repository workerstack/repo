import type { ESTree } from "@oxlint/plugins";

import { declarationOf, movedOf, type Statement } from "./names.ts";
import type { RepoRule } from "./rule.types.ts";

const MESSAGE = "a class file holds one class, its imports and its export";

/** The class a top-level statement declares, bare or exported, or null when it declares none. */
function classOf(statement: Statement): ESTree.Class | null {
  const declaration = declarationOf(statement);
  return declaration?.type === "ClassDeclaration" ? declaration : null;
}

/** `export { C }` or `export default C`: the export of a class declared bare. */
function exportsClass(statement: Statement, name: string | null): boolean {
  if (statement.type === "ExportDefaultDeclaration")
    return statement.declaration.type === "Identifier" && statement.declaration.name === name;
  if (statement.type !== "ExportNamedDeclaration" || statement.source !== null) return false;
  const [only, ...rest] = statement.specifiers;
  return only !== undefined && rest.length === 0 && only.local.type === "Identifier" && only.local.name === name;
}

/**
 * Fails, in a file with a top-level class, every top-level statement but its imports, that class and its export: a
 * helper, a type or a second class goes to its own file, so a file declares functions or a class, never both.
 */
export const classFile: RepoRule = {
  create(context) {
    return {
      Program(program) {
        const owner = program.body.find((statement) => classOf(statement) !== null);
        if (owner === undefined) return;
        const name = classOf(owner)?.id?.name ?? null;
        for (const statement of program.body) {
          if (statement === owner || statement.type === "ImportDeclaration" || exportsClass(statement, name)) continue;
          context.report({ message: `${MESSAGE}; move ${movedOf(statement)} to its own file`, node: statement });
        }
      },
    };
  },
};
