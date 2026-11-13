/** `validateFastPlan`: the head checks a plan shares, then the four fast plan denials. */
import { commitCheck } from "./persist-doc-checks.ts";
import { LAST, MISTAKES_H2, NOT_FOUND } from "./persist-doc.constants.ts";
import {
  FAST_H2,
  FAST_LINE_CAP,
  FINAL_NEWLINE_RE,
  FAST_REQUIRED_KEYS,
  NO_STRATEGY,
  ONLY_OPEN_BOXES,
  ONLY_SECTIONS,
  TOO_LONG,
} from "./persist-fast-plan.constants.ts";
import { type FastRules, validateFastDoc } from "./persist-fast-validate.ts";
import { PLAN_MISTAKE_SOURCES } from "./persist-mistakes.ts";
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
 * The line cap counts the saved file, frontmatter included, without the newline that ends it and without a
 * trailing `## Previous mistakes` log; lines matching `skip` are not counted.
 */
export function fastPlanLineCount(text: string, skip?: RegExp): number {
  const lines = linesAboveLog(text.replace(FINAL_NEWLINE_RE, "").split("\n"));

  return skip === undefined ? lines.length : lines.filter((l) => !skip.test(l)).length;
}

const RULES: FastRules = {
  content: () => [],
  extraHead: [commitCheck],
  headings: FAST_H2,
  lineCap: FAST_LINE_CAP,
  lineCount: (text) => fastPlanLineCount(text),
  noStrategy: NO_STRATEGY,
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
