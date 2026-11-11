/** `validateHandoff`: an ordered table of small checks, so the errors keep their order. */
import {
  createdCheck,
  headingErrors,
  h1Check,
  missingErrors,
  patternErrors,
  serialLineCheck,
  slugCheck,
  sourceLengthCheck,
  validateDoc,
  when,
  type HeadCheck,
  type SectionCheck,
} from "./persist-doc-checks.ts";
import {
  BOX_RE,
  BULLET_H2,
  BULLETS_RE,
  FILENAME_RE,
  GOAL_SENTENCES_MAX,
  LEAF_ID_RE,
  PHASE_ID_RE,
  REQUIRED_H2,
  REQUIRED_KEYS,
  SENTENCE_SPLIT_RE,
  STATUS_RE,
} from "./persist-handoff.constants.ts";

export interface Box {
  id: string;
  fresh: boolean;
}

const HEAD_CHECKS: HeadCheck[] = [
  serialLineCheck,
  (doc) => missingErrors(doc, REQUIRED_KEYS),
  (doc) => patternErrors(doc, "status", STATUS_RE),
  createdCheck,
  sourceLengthCheck,
  slugCheck,
  h1Check,
];

const goalCheck: SectionCheck = (_doc, { bodies }) => {
  const goal = (bodies.Goal || "").trim();
  const sentences = goal.split(SENTENCE_SPLIT_RE).filter((s) => s.trim());
  return when(!goal || sentences.length < 1 || sentences.length > GOAL_SENTENCES_MAX, "goal");
};

const bulletChecks: SectionCheck = (_doc, { bodies }) =>
  BULLET_H2.flatMap((h) => {
    const b = (bodies[h] || "").trim();
    return b ? when(!BULLETS_RE.test(b), `${h} bullets`) : [`${h} empty`];
  });

/** The `N [ ]` lines of Next. */
export function nextBoxes(next: string | undefined): Box[] {
  return (next || "")
    .split("\n")
    .map((line) => BOX_RE.exec(line))
    .filter((m) => m !== null)
    .map((m) => ({ fresh: m.groups?.mark === " ", id: String(m.groups?.id) }));
}

const nextChecks: SectionCheck = (_doc, { bodies }) => {
  const boxes = nextBoxes(bodies.Next);
  const phases = boxes.filter((b) => PHASE_ID_RE.test(b.id));
  return [
    ...boxes.flatMap((b) => when(!b.fresh, "fresh [x]")),
    ...when(!boxes.some((b) => LEAF_ID_RE.test(b.id)), "no N.M leaf"),
    ...phases.flatMap((p) => when(!boxes.some((b) => b.id.startsWith(`${p.id}.`)), `phase ${p.id} leaf`)),
  ];
};

const SECTION_CHECKS: SectionCheck[] = [
  (_doc, sections) => headingErrors(sections, REQUIRED_H2),
  goalCheck,
  bulletChecks,
  nextChecks,
];

export function validateHandoff(filename: string, text: string): string[] {
  return validateDoc({ filename, text }, { filenameRe: FILENAME_RE, head: HEAD_CHECKS, sections: SECTION_CHECKS });
}
