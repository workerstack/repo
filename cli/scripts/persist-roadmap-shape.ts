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
  const norm = String(loc || "").replace(/\\/g, "/");
  if (p.isAbsolute(loc) || DRIVE_RE.test(loc)) return true;
  const prefix = `${PLAN_DIR}/`;
  if (!norm.startsWith(prefix)) return false;
  const base = norm.slice(prefix.length);
  return !base.includes("/") && FILENAME_RE.test(base);
}

/** What the shape checks read from a roadmap under validation. */
export interface ShapeInput {
  text: string;
  body: string;
  order: string[];
  bodies: Record<string, string>;
  fresh: boolean;
  previous?: string | null | undefined;
}

/** A pointer roadmap: no Usage, only Order and Verify, one-line slices, the 60-line cap. */
export function pointerErrors({ text, body, order: allOrder, bodies, fresh, previous }: ShapeInput): string[] {
  const order = allOrder.filter((h) => h !== MISTAKES_H2);
  const kept = order.filter((h) => POINTER_H2.includes(h));
  const slices = parsePointerSlices(bodies.Order || "");
  return [
    ...(fresh ? cardErrors(body) : []),
    ...order
      .filter((h) => !POINTER_H2.includes(h))
      .map(
        (h) => `a new roadmap has only ## Order, ## Verify and ## ${MISTAKES_H2}; move ## ${h} into the slice plans`,
      ),
    ...when(kept.length !== POINTER_H2.length || POINTER_H2.some((h, i) => kept[i] !== h), "heading order"),
    ...when(slices.length < SLICES_MIN, "slices"),
    ...slices.flatMap((slice) => [
      ...when(!slice.ok, `slice ${slice.n} needs "N [ ] {title, 2–6 words}: {one sentence}"`),
      ...when(slice.location !== null && !locationOk(slice.location), "location"),
    ]),
    ...capErrors(text, { cap: POINTER_LINE_CAP, fix: POINTER_CAP_FIX, fresh, previous, skip: LOCATION_LINE_RE }),
  ];
}

const bulletErrors = (bodies: Record<string, string>): string[] =>
  BULLET_H2.flatMap((h) => {
    const b = (bodies[h] || "").trim();
    return when(!b || !BULLETS_RE.test(b), `${h.toLowerCase()} bullets`);
  });

function sliceErrors(slice: Slice): string[] {
  const words = wordsOf(slice.title).length;
  const why = sentences(slice.why).length;
  return [
    ...when(words < TITLE_WORDS_MIN || words > TITLE_WORDS_MAX, "title"),
    ...when(!slice.hasGoal || sentences(slice.goal).length !== 1, "slice goal"),
    ...when(!slice.hasWhy || why < 1 || why > WHY_SENTENCES_MAX, "why"),
    ...when(slice.hasLocation && !locationOk(slice.location), "location"),
  ];
}

/** The old shape roadmaps saved before pointers keep: Goal, Usage, Context, Decisions, Title/Goal/Why slices, Watch-outs. */
export function legacyErrors(
  allOrder: string[],
  bodies: Record<string, string>,
  { fresh }: { fresh: boolean },
): string[] {
  const order = allOrder.filter((h) => h !== MISTAKES_H2 && h !== USAGE_H2);
  const goal = sentences(bodies.Goal || "").length;
  const slices = parseSlices(bodies.Order || "");
  return [
    ...usageErrors(allOrder, bodies, { fresh }),
    ...when(
      REQUIRED_H2.some((h, i) => order[i] !== h),
      "heading order",
    ),
    ...when(
      order.some((h) => !REQUIRED_H2.includes(h)),
      "extra h2",
    ),
    ...when(goal < 1 || goal > GOAL_SENTENCES_MAX, "goal"),
    ...bulletErrors(bodies),
    ...when(slices.length < SLICES_MIN, "slices"),
    ...slices.flatMap(sliceErrors),
  ];
}
