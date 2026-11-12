import path from "node:path";

import { AST_NODE_TYPES } from "@typescript-eslint/utils";

import type { RepoRule } from "./rule.types.ts";

const INDEX = /^index\.(?:ts|tsx|mts|js)$/;
const MESSAGE = "an index file only re-exports; move this into its own module and re-export it";

/** Fails every statement of an index file but `export … from` and `export * from`, type-only forms included. */
export const indexFile: RepoRule<"move"> = {
  create(context) {
    if (!INDEX.test(path.basename(context.filename))) return {};
    return {
      Program(program) {
        for (const statement of program.body) {
          const reexport =
            statement.type === AST_NODE_TYPES.ExportAllDeclaration ||
            (statement.type === AST_NODE_TYPES.ExportNamedDeclaration && statement.source !== null);
          if (!reexport) context.report({ messageId: "move", node: statement });
        }
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
