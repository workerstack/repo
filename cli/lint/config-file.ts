import path from "node:path";

import { AST_NODE_TYPES } from "@typescript-eslint/utils";

import { moveReport, type Statement } from "./names.ts";
import type { RepoRule } from "./rule.types.ts";

/** `vite.config.ts`, `workerstack.config.ts`, `eslint.config.mjs`. */
const CONFIG = /\.config\.(?:ts|mts|js|mjs)$/;
const MESSAGE = "a config file holds only imports and exports";

/** An import, `export default`, or an export that declares nothing: `export { a }`, `export … from`. */
function allowed(statement: Statement): boolean {
  return (
    statement.type === AST_NODE_TYPES.ImportDeclaration ||
    statement.type === AST_NODE_TYPES.ExportDefaultDeclaration ||
    statement.type === AST_NODE_TYPES.ExportAllDeclaration ||
    (statement.type === AST_NODE_TYPES.ExportNamedDeclaration && statement.declaration === null)
  );
}

/** Fails any other statement in a config file: what a config builds lives in a module it imports. */
export const configFile: RepoRule<"move"> = {
  create(context) {
    if (!CONFIG.test(path.basename(context.filename))) return {};
    return {
      Program(program) {
        for (const statement of program.body) {
          if (allowed(statement)) continue;
          context.report(moveReport(statement));
        }
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { move: `${MESSAGE}; move {{moved}} into a module it imports` },
    schema: [],
    type: "problem",
  },
};
