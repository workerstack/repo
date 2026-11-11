/** The checks `validatePlan` runs on a plan's sections once its code fences close, in the order they report. */
import { headingErrors, proseCheck, when } from "./persist-doc-checks.ts";
import { MISTAKES_H2, USAGE_H2 } from "./persist-doc.constants.ts";
import { stripFrontmatter, type FrontmatterMap, type Sections } from "./persist-doc.ts";
import { mistakeLogErrors, PLAN_MISTAKE_SOURCES } from "./persist-mistakes.ts";
import { parallelErrors, planBoxes, planPhases, readPhaseErrors, type PlanPhase } from "./persist-plan-boxes.ts";
import {
  BULLET_H2,
  BULLETS_RE,
  GOAL_SENTENCES_MAX,
  LEAF_ID_RE,
  REQUIRED_H2,
  SENTENCE_SPLIT_RE,
  VERIFY_RE,
} from "./persist-plan.constants.ts";
import { capErrors, cardErrors, sectionBodies, usageErrors } from "./persist-sections.ts";

/** A plan under validation. */
export type Doc = {
  filename: string;
  text: string;
  map: FrontmatterMap;
  body: string;
  fresh: boolean;
  previous: string | null | undefined;
};

type SectionCheck = (doc: Doc, sections: Sections) => string[];

function mistakeChecks({ fresh, previous }: Doc, { order, bodies }: Sections): string[] {
  return mistakeLogErrors(order, bodies, {
    fresh,
    kind: "plan",
    previous: previous == null ? null : sectionBodies(stripFrontmatter(previous)),
    sources: PLAN_MISTAKE_SOURCES,
  });
}

function usageChecks({ fresh }: Doc, { order, bodies }: Sections): string[] {
  return usageErrors(order, bodies, { fresh });
}

function cardChecks({ fresh, body }: Doc): string[] {
  return fresh ? cardErrors(body) : [];
}

function capChecks({ text, fresh, previous }: Doc): string[] {
  return capErrors(text, { fresh, previous });
}

/** Heading order and extra H2s, leaving out the Previous mistakes and Usage sections. */
function headingChecks(_doc: Doc, { order }: Sections): string[] {
  return headingErrors({ order: order.filter((h) => h !== MISTAKES_H2 && h !== USAGE_H2) }, REQUIRED_H2);
}

function verifyError(phases: PlanPhase[]): string[] {
  const last = phases[phases.length - 1];
  return when({
    bad: last !== undefined && !VERIFY_RE.test(last.text) && last.id !== String(phases.length),
    error: "verify last phase",
  });
}

function boxErrors({ text, fresh, previous }: Doc): string[] {
  const boxes = planBoxes(text);
  const phases = planPhases(boxes);
  return [
    ...when({ bad: fresh && boxes.some((b) => b.mark !== " "), error: "fresh [x]" }),
    ...when({ bad: !boxes.some((b) => LEAF_ID_RE.test(b.id)), error: "no N.M leaf" }),
    ...phases.filter((p) => !boxes.some((b) => b.id.startsWith(`${p.id}.`))).map((p) => `phase ${p.id} leaf`),
    ...readPhaseErrors(phases, { fresh, previous }),
    ...parallelErrors(phases),
    ...verifyError(phases),
  ];
}

/** The section checks, in the order their errors print. */
export const BODY_CHECKS: SectionCheck[] = [
  mistakeChecks,
  usageChecks,
  cardChecks,
  capChecks,
  headingChecks,
  /* @__PURE__ */ proseCheck({
    bullets: BULLETS_RE,
    headings: BULLET_H2,
    max: GOAL_SENTENCES_MAX,
    split: SENTENCE_SPLIT_RE,
  }),
  boxErrors,
];
