import path from "node:path";
import type { Rule } from "@oxlint/plugins";
import { movedOf, type Statement } from "./names.ts";

/** `vite.config.ts`, `workerstack.config.ts`, `eslint.config.mjs`. */
const CONFIG = /\.config\.(?:ts|mts|js|mjs)$/;
const MESSAGE = "a config file holds only imports and exports";

/** An import, `export default`, or an export that declares nothing: `export { a }`, `export … from`. */
const allowed = (statement: Statement): boolean =>
  statement.type === "ImportDeclaration" ||
  statement.type === "ExportDefaultDeclaration" ||
  statement.type === "ExportAllDeclaration" ||
  (statement.type === "ExportNamedDeclaration" && statement.declaration === null);

/** Fails any other statement in a config file: what a config builds lives in a module it imports. */
export const configFile = {
  create(context) {
    if (!CONFIG.test(path.basename(context.filename))) return {};
    return {
      Program(program) {
        for (const statement of program.body) {
          if (allowed(statement)) continue;
          context.report({
            message: `${MESSAGE}; move ${movedOf(statement)} into a module it imports`,
            node: statement,
          });
        }
      },
    };
  },
} satisfies Rule;
