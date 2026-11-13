/** `validateFastRoadmap`: the head checks a roadmap shares, then the fast roadmap denials. */
import path from "node:path";

import { when } from "./persist-doc-checks.ts";
import { fastPlanLineCount } from "./persist-fast-plan-validate.ts";
import {
  FAST_PLANS_SEGMENTS,
  FAST_ROADMAP_H2,
  FAST_ROADMAP_LINE_CAP,
  FAST_ROADMAP_REQUIRED_KEYS,
  FAST_SLICES_MIN,
  LOCATION_NOT_FAST_PLAN,
  NO_STRATEGY,
  ONLY_OPEN_BOXES,
  ONLY_SECTIONS,
  PATH_SEPARATOR_RE,
  TOO_FEW_SLICES,
  TOO_LONG,
} from "./persist-fast-roadmap.constants.ts";
import { type FastRules, validateFastDoc } from "./persist-fast-validate.ts";
import { FILENAME_RE } from "./persist-plan.constants.ts";
import { parsePointerSlices } from "./persist-roadmap-slices.ts";
import { LOCATION_LINE_RE, STATUS_RE } from "./persist-roadmap.constants.ts";

type Options = { fresh?: boolean };

/** The last index of an array, for `slice` and `at`. */
const LAST = -1;

/**
 * A Location is a fast plan: an absolute posix or win32 path ending `.repo/plans-fast/<plan file>`, read by
 * segment with either separator and no workspace root.
 */
function locationIsFastPlan(loc: string): boolean {
  const absolute = path.posix.isAbsolute(loc) || path.win32.isAbsolute(loc);
  const segments = loc.split(PATH_SEPARATOR_RE);
  const file = String(segments.at(LAST));
  const dir = segments.slice(LAST - FAST_PLANS_SEGMENTS.length, LAST);

  return absolute && FILENAME_RE.test(file) && dir.join() === FAST_PLANS_SEGMENTS.join();
}

/** The Order denials: how many slices, their shape and their Locations. */
function sliceErrors(order: string): string[] {
  const slices = parsePointerSlices(order);
  const badLocation = slices.some((s) => s.location !== null && !locationIsFastPlan(s.location));

  return [
    ...when({ bad: slices.length < FAST_SLICES_MIN, error: TOO_FEW_SLICES }),
    ...slices.flatMap((s) =>
      when({
        bad: !s.ok,
        error: `slice ${s.n} needs "N [ ] {title}: {one sentence}"`,
      }),
    ),
    ...when({ bad: badLocation, error: LOCATION_NOT_FAST_PLAN }),
  ];
}

/** The saved file's line count for the cap: frontmatter included, Location lines not. */
export function fastRoadmapLineCount(text: string): number {
  return fastPlanLineCount(text, LOCATION_LINE_RE);
}

const RULES: FastRules = {
  content: ({ bodies }) => sliceErrors(bodies.Order ?? ""),
  extraHead: [],
  headings: FAST_ROADMAP_H2,
  lineCap: FAST_ROADMAP_LINE_CAP,
  lineCount: fastRoadmapLineCount,
  noStrategy: NO_STRATEGY,
  onlyOpenBoxes: ONLY_OPEN_BOXES,
  onlySections: ONLY_SECTIONS,
  requiredKeys: FAST_ROADMAP_REQUIRED_KEYS,
  status: STATUS_RE,
  tooLong: TOO_LONG,
};

/**
 * `fresh` is a new fast roadmap: only `[ ]` boxes. An update (`fresh: false`) may tick boxes and move the status.
 * Returns every denial, in order, once each.
 */
export function validateFastRoadmap(filename: string, text: string, { fresh = true }: Options = {}): string[] {
  return validateFastDoc({ filename, fresh, text }, RULES);
}
