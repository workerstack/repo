/** `validateFastPlan`: the head checks a plan shares, then the four fast plan denials. */
import {
  commitCheck,
  createdCheck,
  h1Check,
  missingErrors,
  patternErrors,
  serialLineCheck,
  serialNameCheck,
  slugCheck,
  sourceLengthCheck,
  when,
  type Doc,
  type HeadCheck,
} from "./persist-doc-checks.ts";
import { parseFrontmatter } from "./persist-doc.ts";
import {
  FAST_H2,
  FAST_LINE_CAP,
  FINAL_NEWLINE_RE,
  FAST_REQUIRED_KEYS,
  FAST_TICKED_RE,
  NO_STRATEGY,
  ONLY_OPEN_BOXES,
  ONLY_SECTIONS,
  TOO_LONG,
} from "./persist-fast-plan.constants.ts";
import { extractStrategy } from "./persist-keys.ts";
import { FILENAME_RE, STATUS_RE } from "./persist-plan.constants.ts";
import { sectionBodies, unclosedFenceErrors } from "./persist-sections.ts";

type Options = { fresh?: boolean };

const HEAD_CHECKS: HeadCheck[] = [
  serialLineCheck,
  (doc) => missingErrors(doc, FAST_REQUIRED_KEYS),
  (doc) => patternErrors(doc, "status", STATUS_RE),
  createdCheck,
  sourceLengthCheck,
  commitCheck,
  slugCheck,
  h1Check,
  serialNameCheck,
];

/** The line cap counts the saved file, frontmatter included, without the newline that ends it. */
export function fastPlanLineCount(text: string): number {
  return text.replace(FINAL_NEWLINE_RE, "").split("\n").length;
}

/**
 * `fresh` is a new fast plan: only `[ ]` boxes. An update (`fresh: false`) may tick boxes and move the status.
 * Returns every denial, in order, once each.
 */
export function validateFastPlan(filename: string, text: string, { fresh = true }: Options = {}): string[] {
  const errors: string[] = when({ bad: !FILENAME_RE.test(filename), error: "filename" });
  const fm = parseFrontmatter(text);

  if (fm.error !== undefined) return [...errors, fm.error];
  const doc: Doc = { body: fm.body, filename, map: fm.map, text };
  errors.push(...HEAD_CHECKS.flatMap((check) => check(doc)));
  errors.push(...when({ bad: extractStrategy(text) !== undefined, error: NO_STRATEGY }));
  const fence = unclosedFenceErrors(text);

  if (fence.length > 0) return [...new Set([...errors, ...fence])];
  const { order } = sectionBodies(fm.body);
  errors.push(...when({ bad: FAST_H2.join() !== order.join(), error: ONLY_SECTIONS }));
  errors.push(...when({ bad: fastPlanLineCount(text) > FAST_LINE_CAP, error: TOO_LONG }));
  errors.push(...when({ bad: fresh && FAST_TICKED_RE.test(fm.body), error: ONLY_OPEN_BOXES }));

  return [...new Set(errors)];
}
