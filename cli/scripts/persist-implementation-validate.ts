/** `validateImplementation`: an ordered table of small checks, so the errors keep their order. */
import {
  createdCheck,
  h1Check,
  headingErrors,
  missingErrors,
  patternErrors,
  serialLineCheck,
  slugCheck,
  sourceLengthCheck,
  validateDoc,
  when,
  type Doc,
  type HeadCheck,
  type SectionCheck,
} from "./persist-doc-checks.ts";
import { NONE_LINE } from "./persist-doc.constants.ts";
import type { Sections } from "./persist-doc.ts";
import {
  BLOCKED_STATUS,
  BLOCKERS_H2,
  BULLET_H2,
  BULLET_RE,
  FILENAME_RE,
  FILES_H2,
  LOG_BOX_RE,
  LOG_H2,
  PLAN_VALUE_RE,
  REQUIRED_H2,
  REQUIRED_KEYS,
  STATUS_RE,
  TMP_SEGMENT,
  WINDOWS_DRIVE_RE,
} from "./persist-implementation.constants.ts";

function nonEmptyLines(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** The first problem with a section that holds bullets, `(none)`, or in the Log a numbered box. */
function bulletsOrNone(body: string | undefined, label: string): string {
  const b = (body ?? "").trim();

  if (b === "") return `${label} empty`;
  const bad = b === NONE_LINE ? undefined : nonEmptyLines(b).find((l) => !isBulletLine(l, label));

  return bad === undefined ? "" : `${label} bullets`;
}

function isBulletLine(line: string, label: string): boolean {
  return line === NONE_LINE || (label === LOG_H2 && LOG_BOX_RE.test(line)) || BULLET_RE.test(line);
}

/** The first problem with the Files list: a non-bullet, an absolute path or a `.tmp` path. */
export function filesError(body: string | undefined): string {
  const b = (body ?? "").trim();

  if (b === "") return "Files empty";
  const paths = b === NONE_LINE ? [] : nonEmptyLines(b).filter((l) => l !== NONE_LINE);
  const bad = paths.map(fileLineError).find(Boolean);

  return bad ?? "";
}

function fileLineError(line: string): string {
  if (!BULLET_RE.test(line)) return "Files bullets";
  const p = line.replace(BULLET_RE, "").trim();

  if (p.startsWith("/") || WINDOWS_DRIVE_RE.test(p)) return "Files abs";

  return p.startsWith(TMP_SEGMENT) || p.includes(`/${TMP_SEGMENT}`) ? "Files tmp" : "";
}

const HEAD_CHECKS: HeadCheck[] = [
  serialLineCheck,
  (doc) => missingErrors(doc, REQUIRED_KEYS),
  (doc) => patternErrors(doc, "status", STATUS_RE),
  (doc) => patternErrors(doc, "plan", PLAN_VALUE_RE),
  createdCheck,
  sourceLengthCheck,
  slugCheck,
  h1Check,
];

function bulletChecks(_doc: Doc, { bodies }: Sections): string[] {
  return BULLET_H2.map((h) => bulletsOrNone(bodies[h], h)).filter(Boolean);
}

function filesCheck(_doc: Doc, { bodies }: Sections): string[] {
  return [filesError(bodies[FILES_H2])].filter(Boolean);
}

function blockedCheck({ map }: Doc, { bodies }: Sections): string[] {
  return when({
    bad: map.status === BLOCKED_STATUS && (bodies[BLOCKERS_H2] ?? "").trim() === NONE_LINE,
    error: "blocked blockers",
  });
}

const SECTION_CHECKS: SectionCheck[] = [
  (_doc, sections) => headingErrors(sections, REQUIRED_H2),
  bulletChecks,
  filesCheck,
  blockedCheck,
];

export function validateImplementation(filename: string, text: string): string[] {
  return validateDoc({ filename, text }, { filenameRe: FILENAME_RE, head: HEAD_CHECKS, sections: SECTION_CHECKS });
}
