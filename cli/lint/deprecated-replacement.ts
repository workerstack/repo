import { AST_TOKEN_TYPES } from "@typescript-eslint/utils";

import { DEPRECATED, MESSAGE, NEXT_TAG, REPLACEMENT } from "./deprecated-replacement.constants.ts";
import type { RepoRule } from "./rule.types.ts";

/** The text of the deprecation tag in a JSDoc block's `value`, or null when it has none. */
function deprecatedText(value: string): string | null {
  const tag = DEPRECATED.exec(value);
  if (tag === null) return null;
  const rest = value.slice(tag.index + tag[0].length);
  const end = rest.search(NEXT_TAG);
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * Fails a deprecation tag that names no replacement: a caller who sees the strike-through needs to know what to use
 * instead. It applies to every JSDoc block, public or not.
 */
export const deprecatedReplacement: RepoRule<"replacement"> = {
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type !== AST_TOKEN_TYPES.Block || !comment.value.startsWith("*")) continue;
          const text = deprecatedText(comment.value);
          if (text !== null && !REPLACEMENT.test(text)) context.report({ messageId: "replacement", node: comment });
        }
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { replacement: MESSAGE },
    schema: [],
    type: "problem",
  },
};
