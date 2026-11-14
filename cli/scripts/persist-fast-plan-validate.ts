/** `validateFastPlan`: the head checks a plan shares, then the four fast plan denials. */
import { parallelGroupErrors, parallelList } from "./parallel-groups.ts";
import { commitCheck } from "./persist-doc-checks.ts";
import { LAST, MISTAKES_H2, NOT_FOUND } from "./persist-doc.constants.ts";
import {
  FAST_H2,
  FAST_LINE_CAP,
  FINAL_NEWLINE_RE,
  FAST_REQUIRED_KEYS,
  SAVED_KEY_LINE_RE,
  ONLY_OPEN_BOXES,
  ONLY_SECTIONS,
  TOO_LONG,
  verifyParallelError,
} from "./persist-fast-plan.constants.ts";
import { type FastRules, validateFastDoc } from "./persist-fast-validate.ts";
import { PLAN_MISTAKE_SOURCES } from "./persist-mistakes.ts";
import { planBoxes } from "./persist-plan-boxes.ts";
import { STATUS_RE } from "./persist-plan.constants.ts";
import { lastHeadingIndex } from "./persist-sections.ts";

type Options = { fresh?: boolean; previous?: string };

/**
 * Lines above the last `## Previous mistakes` heading outside a fence, without the blank lines just before it; all
 * lines without one.
 */
function linesAboveLog(lines: string[]): string[] {
  const at = lastHeadingIndex(lines, MISTAKES_H2);

  if (at === NOT_FOUND) return lines;
  const above = lines.slice(0, at);

  while (above.at(LAST)?.trim() === "") above.pop();

  return above;
}

/**
 * The line cap counts the saved file, frontmatter included, without the newline that ends it, without a trailing
 * `## Previous mistakes` log, and without the `strategy:` and `advice:` lines; lines matching `skip` are not counted.
 */
export function fastPlanLineCount(text: string, skip?: RegExp): number {
  const lines = linesAboveLog(text.replace(FINAL_NEWLINE_RE, "").split("\n"));

  return lines.filter((l) => !SAVED_KEY_LINE_RE.test(l) && skip?.test(l) !== true).length;
}

/** The Steps' `(parallel: …)` groups, and a marker on a Verify box, which never runs at once. */
function parallelStepErrors({ Steps = "", Verify = "" }: Record<string, string>): string[] {
  const steps = planBoxes(Steps).map((b) => ({ files: parallelList(b.text), id: b.id }));
  const marked = planBoxes(Verify).filter((b) => parallelList(b.text) !== null);

  return [...parallelGroupErrors(steps, "step"), ...marked.map((b) => verifyParallelError(b.id))];
}

const RULES: FastRules = {
  content: ({ bodies }) => parallelStepErrors(bodies),
  extraHead: [commitCheck],
  headings: FAST_H2,
  lineCap: FAST_LINE_CAP,
  lineCount: (text) => fastPlanLineCount(text),
  onlyOpenBoxes: ONLY_OPEN_BOXES,
  onlySections: ONLY_SECTIONS,
  requiredKeys: FAST_REQUIRED_KEYS,
  sources: PLAN_MISTAKE_SOURCES,
  status: STATUS_RE,
  tooLong: TOO_LONG,
};

/**
 * `fresh` is a new fast plan: only `[ ]` boxes. An update (`fresh: false`) may tick boxes and move the status;
 * `previous` is the saved text it replaces. Returns every denial, in order, once each.
 */
export function validateFastPlan(filename: string, text: string, { fresh = true, previous }: Options = {}): string[] {
  return validateFastDoc({ filename, fresh, previous, text }, RULES);
}
