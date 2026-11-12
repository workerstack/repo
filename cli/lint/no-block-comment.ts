import { commentLines } from "./comment-lines.ts";
import { BANNER, CONFIG, CRLF, DOC, LF, MESSAGE } from "./no-block-comment.constants.ts";
import type { RepoRule, RuleComment } from "./rule.types.ts";

/** The text before `comment` on its line when only whitespace stands on both sides of it, else `null`. */
function indentOf(text: string, comment: RuleComment): string | null {
  const lineStart = text.lastIndexOf(LF, comment.start - 1) + 1;
  const found = text.indexOf(LF, comment.end);
  const lineEnd = found < 0 ? text.length : found;
  const before = text.slice(lineStart, comment.start);
  if (before.trim() !== "" || text.slice(comment.end, lineEnd).trim() !== "") return null;
  return before;
}

/** Whether the rule leaves `comment` as a block: a doc, a first-line banner, or a config comment. */
function kept(text: string, comment: RuleComment): boolean {
  if (comment.value.startsWith(DOC) || CONFIG.test(comment.value)) return true;
  return comment.value.startsWith(BANNER) && !text.slice(0, comment.start).includes(LF);
}

/**
 * Fails a block comment alone on its lines and rewrites it as one `//` line per line of text. A doc, a comment
 * inside a line, a first-line banner and a config comment stay.
 */
export const noBlockComment: RepoRule = {
  create(context) {
    return {
      Program() {
        const { text } = context.sourceCode;
        const eol = text.includes(CRLF) ? CRLF : LF;
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type !== "Block" || kept(text, comment)) continue;
          const indent = indentOf(text, comment);
          if (indent === null) continue;
          const replacement = commentLines(comment.value, indent.length).join(`${eol}${indent}`);
          context.report({
            fix: (fixer) => fixer.replaceTextRange([comment.start, comment.end], replacement),
            message: MESSAGE,
            node: comment,
          });
        }
      },
    };
  },
  meta: { fixable: "whitespace" },
};
