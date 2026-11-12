/** The two shapes a roadmap's sections take: the pointer card of a new roadmap and the legacy full form. */
import path from "node:path";

import { when } from "./persist-doc-checks.ts";
import { MISTAKES_H2, USAGE_H2 } from "./persist-doc.constants.ts";
import { FILENAME_RE, PLAN_DIR } from "./persist-plan.constants.ts";
import { parsePointerSlices, parseSlices, sentences, wordsOf, type Slice } from "./persist-roadmap-slices.ts";
import {
  BULLET_H2,
  BULLETS_RE,
  DRIVE_RE,
  GOAL_SENTENCES_MAX,
  LOCATION_LINE_RE,
  POINTER_CAP_FIX,
  POINTER_H2,
  POINTER_LINE_CAP,
  REQUIRED_H2,
  SLICES_MIN,
  TITLE_WORDS_MAX,
  TITLE_WORDS_MIN,
  WHY_SENTENCES_MAX,
} from "./persist-roadmap.constants.ts";
import { capErrors, cardErrors, usageErrors } from "./persist-sections.ts";

/**
 * A slice's Location: any absolute path, or a plan file under `.tmp/repo/plans/`. A drive-letter
 * path is absolute under every platform's rules, so a roadmap written on Windows checks the same on posix.
 */
export function locationOk(loc: string, p: path.PlatformPath = path): boolean {
  const norm = loc.replaceAll("\\", "/");

  if (p.isAbsolute(loc) || DRIVE_RE.test(loc)) return true;
  const prefix = `${PLAN_DIR}/`;

  if (!norm.startsWith(prefix)) return false;
  const base = norm.slice(prefix.length);

  return !base.includes("/") && FILENAME_RE.test(base);
}

/** What the shape checks read from a roadmap under validation. */
export type RoadmapInput = {
  text: string;
  body: string;
  order: string[];
  bodies: Record<string, string>;
  fresh: boolean;
  previous?: string | null | undefined;
};

/** A pointer roadmap: no Usage, only Order and Verify, one-line slices, the 60-line cap. */
export function pointerErrors({ text, body, order: allOrder, bodies, fresh, previous }: RoadmapInput): string[] {
  const order = allOrder.filter((h) => h !== MISTAKES_H2);
  const kept = order.filter((h) => POINTER_H2.includes(h));
  const slices = parsePointerSlices(bodies.Order ?? "");

  return [
    ...(fresh ? cardErrors(body) : []),
    ...order
      .filter((h) => !POINTER_H2.includes(h))
      .map(
        (h) => `a new roadmap has only ## Order, ## Verify and ## ${MISTAKES_H2}; move ## ${h} into the slice plans`,
      ),
    ...when({
      bad: kept.length !== POINTER_H2.length || POINTER_H2.some((h, i) => kept[i] !== h),
      error: "heading order",
    }),
    ...when({ bad: slices.length < SLICES_MIN, error: "slices" }),
    ...slices.flatMap((slice) => [
      ...when({ bad: !slice.ok, error: `slice ${slice.n} needs "N [ ] {title, 2–6 words}: {one sentence}"` }),
      ...when({ bad: slice.location !== null && !locationOk(slice.location), error: "location" }),
    ]),
    ...capErrors(text, { cap: POINTER_LINE_CAP, fix: POINTER_CAP_FIX, fresh, previous, skip: LOCATION_LINE_RE }),
  ];
}

function bulletErrors(bodies: Record<string, string>): string[] {
  return BULLET_H2.flatMap((h) => {
    const b = (bodies[h] ?? "").trim();

    return when({ bad: b === "" || !BULLETS_RE.test(b), error: `${h.toLowerCase()} bullets` });
  });
}

function sliceErrors(slice: Slice): string[] {
  const words = wordsOf(slice.title).length;
  const why = sentences(slice.why).length;

  return [
    ...when({ bad: words < TITLE_WORDS_MIN || words > TITLE_WORDS_MAX, error: "title" }),
    ...when({ bad: !slice.hasGoal || sentences(slice.goal).length !== 1, error: "slice goal" }),
    ...when({ bad: !slice.hasWhy || why < 1 || why > WHY_SENTENCES_MAX, error: "why" }),
    ...when({ bad: slice.hasLocation && !locationOk(slice.location), error: "location" }),
  ];
}

/**
 * The old shape roadmaps saved before pointers keep: Goal, Usage, Context, Decisions, Title/Goal/Why slices,
 * Watch-outs.
 */
export function legacyErrors(
  allOrder: string[],
  bodies: Record<string, string>,
  { fresh }: { fresh: boolean },
): string[] {
  const order = allOrder.filter((h) => h !== MISTAKES_H2 && h !== USAGE_H2);
  const goal = sentences(bodies.Goal ?? "").length;
  const slices = parseSlices(bodies.Order ?? "");

  return [
    ...usageErrors(allOrder, bodies, { fresh }),
    ...when({ bad: REQUIRED_H2.some((h, i) => order[i] !== h), error: "heading order" }),
    ...when({ bad: order.some((h) => !REQUIRED_H2.includes(h)), error: "extra h2" }),
    ...when({ bad: goal < 1 || goal > GOAL_SENTENCES_MAX, error: "goal" }),
    ...bulletErrors(bodies),
    ...when({ bad: slices.length < SLICES_MIN, error: "slices" }),
    ...slices.flatMap(sliceErrors),
  ];
}
