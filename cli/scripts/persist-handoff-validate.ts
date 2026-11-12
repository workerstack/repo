/** `validateHandoff`: an ordered table of small checks, so the errors keep their order. */
import {
  createdCheck,
  headingErrors,
  h1Check,
  missingErrors,
  patternErrors,
  proseCheck,
  serialLineCheck,
  slugCheck,
  sourceLengthCheck,
  validateDoc,
  when,
  type Doc,
  type HeadCheck,
  type SectionCheck,
} from "./persist-doc-checks.ts";
import type { Sections } from "./persist-doc.ts";
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

export type Box = {
  id: string;
  fresh: boolean;
};

const HEAD_CHECKS: HeadCheck[] = [
  serialLineCheck,
  (doc) => missingErrors(doc, REQUIRED_KEYS),
  (doc) => patternErrors(doc, "status", STATUS_RE),
  createdCheck,
  sourceLengthCheck,
  slugCheck,
  h1Check,
];

/** The `N [ ]` lines of Next. */
export function nextBoxes(next: string | undefined): Box[] {
  return (next ?? "")
    .split("\n")
    .map((line) => BOX_RE.exec(line))
    .filter((m) => m !== null)
    .map((m) => ({ fresh: m.groups?.mark === " ", id: String(m.groups?.id) }));
}

function nextChecks(_doc: Doc, { bodies }: Sections): string[] {
  const boxes = nextBoxes(bodies.Next);
  const phases = boxes.filter((b) => PHASE_ID_RE.test(b.id));

  return [
    ...boxes.flatMap((b) => when({ bad: !b.fresh, error: "fresh [x]" })),
    ...when({ bad: !boxes.some((b) => LEAF_ID_RE.test(b.id)), error: "no N.M leaf" }),
    ...phases.flatMap((p) =>
      when({ bad: !boxes.some((b) => b.id.startsWith(`${p.id}.`)), error: `phase ${p.id} leaf` }),
    ),
  ];
}

const SECTION_CHECKS: SectionCheck[] = [
  (_doc, sections) => headingErrors(sections, REQUIRED_H2),
  /* @__PURE__ */ proseCheck({
    bullets: BULLETS_RE,
    headings: BULLET_H2,
    max: GOAL_SENTENCES_MAX,
    split: SENTENCE_SPLIT_RE,
  }),
  nextChecks,
];

export function validateHandoff(filename: string, text: string): string[] {
  return validateDoc({ filename, text }, { filenameRe: FILENAME_RE, head: HEAD_CHECKS, sections: SECTION_CHECKS });
}
