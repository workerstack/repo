import { MISTAKES_H2, USAGE_H2 } from "./persist-doc.constants.ts";
/** The checks `validatePlan` runs on a plan's sections once its code fences close, in the order they report. */
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

export const when = (bad: boolean, error: string): string[] => (bad ? [error] : []);

const mistakeChecks: SectionCheck = ({ fresh, previous }, { order, bodies }) =>
  mistakeLogErrors(order, bodies, {
    fresh,
    kind: "plan",
    previous: previous == null ? null : sectionBodies(stripFrontmatter(previous)),
    sources: PLAN_MISTAKE_SOURCES,
  });

const usageChecks: SectionCheck = ({ fresh }, { order, bodies }) => usageErrors(order, bodies, { fresh });

const cardChecks: SectionCheck = ({ fresh, body }) => (fresh ? cardErrors(body) : []);

const capChecks: SectionCheck = ({ text, fresh, previous }) => capErrors(text, { fresh, previous });

const headingErrors: SectionCheck = (_doc, { order: all }) => {
  const order = all.filter((h) => h !== MISTAKES_H2 && h !== USAGE_H2);
  const firstSix = order.slice(0, REQUIRED_H2.length);
  return [
    ...when(
      REQUIRED_H2.some((h, i) => firstSix[i] !== h),
      "heading order",
    ),
    ...when(
      order.some((h) => !REQUIRED_H2.includes(h)),
      "extra h2",
    ),
  ];
};

const goalError: SectionCheck = (_doc, { bodies }) => {
  const goal = (bodies.Goal || "").trim();
  const sentences = goal.split(SENTENCE_SPLIT_RE).filter((s) => s.trim());
  return when(!goal || !sentences.length || sentences.length > GOAL_SENTENCES_MAX, "goal");
};

const bulletErrors: SectionCheck = (_doc, { bodies }) =>
  BULLET_H2.flatMap((h) => {
    const b = (bodies[h] || "").trim();
    if (!b) return [`${h} empty`];
    return when(!BULLETS_RE.test(b), `${h} bullets`);
  });

function verifyError(phases: PlanPhase[]): string[] {
  const last = phases[phases.length - 1];
  return when(!!last && !VERIFY_RE.test(last.text) && last.id !== String(phases.length), "verify last phase");
}

const boxErrors: SectionCheck = ({ text, fresh, previous }) => {
  const boxes = planBoxes(text);
  const phases = planPhases(boxes);
  return [
    ...when(fresh && boxes.some((b) => b.mark !== " "), "fresh [x]"),
    ...when(!boxes.some((b) => LEAF_ID_RE.test(b.id)), "no N.M leaf"),
    ...phases.filter((p) => !boxes.some((b) => b.id.startsWith(`${p.id}.`))).map((p) => `phase ${p.id} leaf`),
    ...readPhaseErrors(phases, { fresh, previous }),
    ...parallelErrors(phases),
    ...verifyError(phases),
  ];
};

/** The section checks, in the order their errors print. */
export const BODY_CHECKS: SectionCheck[] = [
  mistakeChecks,
  usageChecks,
  cardChecks,
  capChecks,
  headingErrors,
  goalError,
  bulletErrors,
  boxErrors,
];
