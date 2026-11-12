import type { RepoRule } from "./rule.types.ts";

const ADVICE = "import a function from it and call that";

/**
 * Fails an import that binds nothing: it is there only to run the module, so importing it has an effect no caller
 * chose. `import type` is erased and passes.
 */
export const noSideEffectImport: RepoRule<"effect"> = {
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.specifiers.length > 0 || node.importKind === "type") return;
        context.report({ data: { source: node.source.value }, messageId: "effect", node });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { effect: `import "{{source}}" runs a module for its effects; ${ADVICE}` },
    schema: [],
    type: "problem",
  },
};
