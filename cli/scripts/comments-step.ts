/**
 * Turn's step that refuses rule-disable comments, `@ts-ignore`, `@ts-nocheck` and an `@ts-expect-error` with no
 * reason in the turn's changed source files, as `repo check` does over the whole tree.
 */
import { commentProblems } from "../check-comments.ts";
import type { Step } from "./turn-steps.ts";

/** `comments ok`, or `comments <n> refused` with one line per refused comment. */
export const commentsStep: Step = (turn) => {
  const files = turn.changes.filter((change) => !change.deleted).map((change) => change.rel);
  const problems = commentProblems(turn.root, files);
  if (problems.length === 0) return { label: "comments ok", ok: true, output: [], touched: [] };
  const output = problems.map((problem) => `${problem}\n`);
  return { label: `comments ${problems.length} refused`, ok: false, output, touched: [] };
};
