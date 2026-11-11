/** `validatePlan`: an ordered table of small checks, so the errors keep their order. */
import path from "node:path";

import {
  createdCheck,
  h1Check,
  missingErrors,
  patternErrors,
  serialLineCheck,
  slugCheck,
  sourceLengthCheck,
  when,
} from "./persist-doc-checks.ts";
import { SERIAL_PREFIX_RE } from "./persist-doc.constants.ts";
import { hasKey, parseFrontmatter } from "./persist-doc.ts";
import { modeErrors, strategyError } from "./persist-keys.ts";
import { reviewErrors } from "./persist-mistakes.ts";
import { BODY_CHECKS, type Doc } from "./persist-plan-body-checks.ts";
import {
  ABSOLUTE_PATH,
  COMMIT_SUBJECT_RE,
  EXTENSION_RE,
  FILENAME_RE,
  RELATIVE_PATH,
  REQUIRED_KEYS,
  REVIEW_COMMAND,
  REVIEWS_TO_ENTER,
  STATUS_RE,
  TRAILING_PUNCT_RE,
} from "./persist-plan.constants.ts";
import { sectionBodies, unclosedFenceErrors } from "./persist-sections.ts";
import { parseStrategy } from "./strategy.ts";
import { canonicalPath } from "./workspace-root.ts";

type Options = {
  fresh?: boolean;
  previous?: string | null | undefined;
};

type Check = (doc: Doc) => string[];

function statusError(doc: Doc): string[] {
  return patternErrors(doc, "status", STATUS_RE);
}

function requiredErrors(doc: Doc): string[] {
  return missingErrors(doc, REQUIRED_KEYS);
}

function commitError({ map }: Doc): string[] {
  return when({ bad: hasKey(map, "commit") && !COMMIT_SUBJECT_RE.test(String(map.commit)), error: "commit" });
}

function strategyErrors({ map }: Doc): string[] {
  return when({ bad: parseStrategy(map.strategy) === null, error: strategyError() });
}

function modeChecks({ map }: Doc): string[] {
  return modeErrors(map);
}

function reviewChecks({ map, previous }: Doc): string[] {
  return reviewErrors(map, (previous == null ? null : parseFrontmatter(previous))?.map ?? null, {
    gates: REVIEWS_TO_ENTER,
    review: REVIEW_COMMAND,
  });
}

function serialNameError({ filename, map }: Doc): string[] {
  const fileSerial = SERIAL_PREFIX_RE.exec(filename)?.[1];
  const named = fileSerial !== undefined && map.serial !== undefined && map.serial !== "";
  return when({ bad: named && Number(map.serial) !== Number(fileSerial), error: "serial/filename" });
}

/** Checks on the frontmatter and the name, run before the sections are read. */
const HEAD_CHECKS: Check[] = [
  serialLineCheck,
  requiredErrors,
  statusError,
  createdCheck,
  sourceLengthCheck,
  commitError,
  strategyErrors,
  modeChecks,
  slugCheck,
  h1Check,
  reviewChecks,
  serialNameError,
];

/**
 * `fresh` is a new plan: no `[x]`, Previous mistakes required. `previous` is the saved text an
 * update replaces: its Previous mistakes entries must survive unchanged and in order.
 */
export function validatePlan(filename: string, text: string, { fresh = true, previous }: Options = {}): string[] {
  const errors: string[] = when({ bad: !FILENAME_RE.test(filename), error: "filename" });
  const fm = parseFrontmatter(text);
  if (fm.error !== undefined) return [...errors, fm.error];
  const doc: Doc = { body: fm.body, filename, fresh, map: fm.map, previous, text };
  errors.push(...HEAD_CHECKS.flatMap((check) => check(doc)));
  const fence = unclosedFenceErrors(text);
  if (fence.length > 0) return [...errors, ...fence];
  const sections = sectionBodies(fm.body);
  errors.push(...BODY_CHECKS.flatMap((check) => check(doc, sections)));
  return [...new Set(errors)];
}

function trim(m: string): string {
  return m.replace(TRAILING_PUNCT_RE, "");
}

/** Every match of `pattern` in `text`, scanned with a fresh global copy so no match state outlives the call. */
function allMatches(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(new RegExp(pattern.source, "g"))].map((m) => m[0]);
}

/**
 * Paths under `ws` (the root) that `text` names: absolute as written (either separator, any case on Windows, any
 * spelling of `ws`: a symlink, an 8.3 name), then repo-relative ones resolved against `ws`. Paths under
 * `<ws>/.worktrees/<name>/` count like any other. A sibling dir that shares the prefix does not.
 */
export function workspacePaths(ws: string, text: unknown, p: path.PlatformPath = path): string[] {
  const top = canonicalPath(p.resolve(ws), p);
  function under(abs: string) {
    const rel = p.relative(top, canonicalPath(abs, p));
    return rel !== "" && !rel.startsWith("..") && !p.isAbsolute(rel);
  }
  const source = String(text);
  const absolute = allMatches(ABSOLUTE_PATH, source).map(trim).filter(under);
  const relative = allMatches(RELATIVE_PATH, source)
    .map(trim)
    .filter((m) => EXTENSION_RE.test(m))
    .map((m) => p.resolve(top, m))
    .filter(under);
  return [...new Set([...absolute, ...relative])];
}
