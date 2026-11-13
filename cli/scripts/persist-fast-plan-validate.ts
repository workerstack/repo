/** `validateFastPlan`: the head checks a plan shares, then the four fast plan denials. */
import { commitCheck } from "./persist-doc-checks.ts";
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
import { STATUS_RE } from "./persist-plan.constants.ts";

type Options = { fresh?: boolean };

/**
 * The line cap counts the saved file, frontmatter included, without the newline that ends it; lines matching
 * `skip` are not counted.
 */
export function fastPlanLineCount(text: string, skip?: RegExp): number {
  const lines = text.replace(FINAL_NEWLINE_RE, "").split("\n");

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
  status: STATUS_RE,
  tooLong: TOO_LONG,
};

/**
 * `fresh` is a new fast plan: only `[ ]` boxes. An update (`fresh: false`) may tick boxes and move the status.
 * Returns every denial, in order, once each.
 */
export function validateFastPlan(filename: string, text: string, { fresh = true }: Options = {}): string[] {
  return validateFastDoc({ filename, fresh, text }, RULES);
}
