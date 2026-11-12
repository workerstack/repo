import type { RepoRule } from "./rule.types.ts";

/** The v8 coverage provider honors all three tools' hints; each hides uncovered code behind a full score. */
const HINT = /\b(?:v8|c8|istanbul)\s+ignore\b/i;
const MESSAGE = "coverage ignore comments hide untested code; delete the code or add a test that runs it";

/** Fails every coverage ignore comment, reported on the comment. */
export const noV8Ignore: RepoRule<"hint"> = {
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments())
          if (HINT.test(comment.value)) context.report({ messageId: "hint", node: comment });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { hint: MESSAGE },
    schema: [],
    type: "problem",
  },
};
