/** `validateRoadmap`: an ordered table of small checks, so the errors keep their order. */
import { type FrontmatterMap, type Sections, frontmatterMap, slugFromFilename } from "./persist-doc.ts";
import { FM_CLOSE, FM_LINE_LOOSE_RE, FM_OPEN, GOAL_H2, NOT_FOUND } from "./persist-doc.constants.ts";
import { when } from "./persist-doc-checks.ts";
import { modeErrors, strategyError } from "./persist-keys.ts";
import { mistakeLogErrors, reviewErrors } from "./persist-mistakes.ts";
import { sectionBodies, unclosedFenceErrors } from "./persist-sections.ts";
import { parseStrategy } from "./strategy.ts";
import {
  BOX_RE,
  DRAFT_STATUS,
  LEAF_RE,
  LEAVES_MAX,
  REQUIRED_KEYS,
  REVIEW_COMMAND,
  REVIEWS_TO_ENTER,
  ROADMAP_FILENAME_RE,
  ROADMAP_MISTAKE_SOURCES,
  STATUS_RE,
} from "./persist-roadmap.constants.ts";
import { legacyErrors, pointerErrors } from "./persist-roadmap-shape.ts";

/** A saved roadmap's frontmatter and the text after it. */
export interface Split {
  body: string;
  map: FrontmatterMap;
}

/** A roadmap under validation. */
interface Roadmap {
  filename: string;
  text: string;
  previous: string | null | undefined;
  fresh: boolean;
  slug: string;
  map: FrontmatterMap;
  body: string;
  prev: Split | null;
  pointer: boolean;
}

type HeadCheck = (r: Roadmap) => string[];
type SectionCheck = (r: Roadmap, sections: Sections) => string[];

/** The roadmap's own loose frontmatter reader: no frontmatter is an empty map, not an error. */
export function splitFrontmatter(text: unknown): Split {
  const s = String(text).replace(/^﻿/, "");
  const end = s.startsWith(FM_OPEN) ? s.indexOf(FM_CLOSE, FM_OPEN.length) : NOT_FOUND;
  if (end === NOT_FOUND) return { body: s, map: {} };
  return { body: s.slice(end + FM_CLOSE.length), map: frontmatterMap(s.slice(FM_OPEN.length, end), FM_LINE_LOOSE_RE) };
}

const HEAD_CHECKS: HeadCheck[] = [
  ({ filename }) => when(!ROADMAP_FILENAME_RE.test(filename), "filename"),
  ({ map }) =>
    when(
      REQUIRED_KEYS.some((k) => !map[k]),
      "frontmatter",
    ),
  ({ map }) => when(!!map.status && !STATUS_RE.test(map.status), "status"),
  ({ map }) => when(!parseStrategy(map.strategy), strategyError()),
  ({ map }) => modeErrors(map),
  ({ map, prev }) => reviewErrors(map, prev ? prev.map : null, { gates: REVIEWS_TO_ENTER, review: REVIEW_COMMAND }),
  ({ map, slug }) => when(!!map.name && map.name !== slug, "name"),
  ({ body, slug }) => when(!body.trim().startsWith(`# ${slug}`), "h1"),
];

/** The ids and unchecked state of the `N [ ]` lines of a section. */
function boxes(section: string | undefined): { id: string; fresh: boolean }[] {
  return String(section || "")
    .split("\n")
    .flatMap((line) => {
      const m = line.match(BOX_RE);
      return m ? [{ id: String(m.groups?.id), fresh: m.groups?.mark === " " }] : [];
    });
}

const SECTION_CHECKS: SectionCheck[] = [
  ({ fresh, prev }, { order, bodies }) =>
    mistakeLogErrors(order, bodies, {
      fresh,
      previous: prev && sectionBodies(prev.body),
      sources: ROADMAP_MISTAKE_SOURCES,
      kind: "roadmap",
    }),
  ({ pointer, text, body, fresh, previous }, { order, bodies }) =>
    pointer ? pointerErrors({ text, body, order, bodies, fresh, previous }) : legacyErrors(order, bodies, { fresh }),
  ({ fresh, map }) => when(fresh && !!map.status && map.status !== DRAFT_STATUS, "fresh status"),
  ({ fresh }, { bodies }) => when(fresh && boxes(bodies.Order).some((b) => !b.fresh), "fresh [x]"),
  ({ fresh }, { bodies }) => when(fresh && boxes(bodies.Verify).some((b) => !b.fresh), "fresh [x]"),
  (_r, { bodies }) => {
    const leaves = boxes(bodies.Verify).filter((b) => LEAF_RE.test(b.id));
    return when(leaves.length < 1 || leaves.length > LEAVES_MAX, "verify");
  },
];

function load(
  filename: string,
  text: string,
  { fresh, previous }: { fresh: boolean; previous: string | null | undefined },
): Roadmap {
  const { body, map } = splitFrontmatter(text);
  const prev = previous == null ? null : splitFrontmatter(previous);
  // A new roadmap is always a pointer roadmap. An update keeps the saved file's shape, so deleting
  // ## Goal cannot move an old roadmap under other rules; with no saved file the text decides.
  const pointer = fresh || !sectionBodies((prev ?? { body }).body).order.includes(GOAL_H2);
  return { filename, text, previous, fresh, slug: slugFromFilename(filename), map, body, prev, pointer };
}

export function validateRoadmap(
  filename: string,
  text: string,
  { fresh = false, previous }: { fresh?: boolean; previous?: string | null | undefined } = {},
): string[] {
  const roadmap = load(filename, text, { fresh, previous });
  const errors = HEAD_CHECKS.flatMap((check) => check(roadmap));
  const fence = unclosedFenceErrors(text);
  if (fence.length) return [...new Set([...errors, ...fence])];
  const sections = sectionBodies(roadmap.body);
  return [...new Set([...errors, ...SECTION_CHECKS.flatMap((check) => check(roadmap, sections))])];
}
