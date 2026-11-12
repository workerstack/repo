import { AST_NODE_TYPES } from "@typescript-eslint/utils";

import type { Statement } from "./names.ts";
import type { RepoRule } from "./rule.types.ts";

const MESSAGE = "a .types.ts file holds only exported types and interfaces; move this into a module";
const TYPES = ["TSTypeAliasDeclaration", "TSInterfaceDeclaration"];

/** `import type`, an exported type alias or interface, or `export type … from`. */
function typeOnly(statement: Statement): boolean {
  if (statement.type === AST_NODE_TYPES.ImportDeclaration) return statement.importKind === "type";
  if (statement.type === AST_NODE_TYPES.ExportAllDeclaration) return statement.exportKind === "type";
  if (statement.type !== AST_NODE_TYPES.ExportNamedDeclaration) return false;
  if (statement.declaration !== null) return TYPES.includes(statement.declaration.type);
  return statement.source !== null && statement.exportKind === "type";
}

/** Fails every statement of a `*.types.ts` file that is not a type: such a file is erased whole at build. */
export const typesFile: RepoRule<"move"> = {
  create(context) {
    if (!context.filename.endsWith(".types.ts")) return {};
    return {
      Program(program) {
        for (const statement of program.body)
          if (!typeOnly(statement)) context.report({ messageId: "move", node: statement });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { move: MESSAGE },
    schema: [],
    type: "problem",
  },
};
