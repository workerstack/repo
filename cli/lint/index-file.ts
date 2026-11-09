import path from "node:path";
import type { CreateRule } from "@oxlint/plugins";

const INDEX = /^index\.(?:ts|tsx|mts|js)$/;
const MESSAGE = "an index file only re-exports; move this into its own module and re-export it";

/** Fails every statement of an index file but `export … from` and `export * from`, type-only forms included. */
export const indexFile: CreateRule = {
  create(context) {
    if (!INDEX.test(path.basename(context.filename))) return {};
    return {
      Program(program) {
        for (const statement of program.body) {
          const reexport =
            statement.type === "ExportAllDeclaration" ||
            (statement.type === "ExportNamedDeclaration" && statement.source !== null);
          if (!reexport) context.report({ message: MESSAGE, node: statement });
        }
      },
    };
  },
};
