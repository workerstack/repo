import type { CreateRule } from "@oxlint/plugins";

const ADVICE = "import a function from it and call that";

/**
 * Fails an import that binds nothing: it is there only to run the module, so importing it has an effect no caller
 * chose. `import type` is erased and passes.
 */
export const noSideEffectImport: CreateRule = {
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.specifiers.length > 0 || node.importKind === "type") return;
        const message = `import "${node.source.value}" runs a module for its effects; ${ADVICE}`;
        context.report({ message, node });
      },
    };
  },
};
