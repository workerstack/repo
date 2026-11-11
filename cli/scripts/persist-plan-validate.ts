/** `validatePlan`: an ordered table of small checks, so the errors keep their order. */
import path from "node:path";

import { CREATED_RE, SERIAL_LINE_RE, SERIAL_PREFIX_RE, SOURCE_MAX } from "./persist-doc.constants.ts";
import { hasKey, parseFrontmatter, slugFromFilename } from "./persist-doc.ts";
import { modeErrors, strategyError } from "./persist-keys.ts";
import { reviewErrors } from "./persist-mistakes.ts";
import { BODY_CHECKS, when, type Doc } from "./persist-plan-body-checks.ts";
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

const serialLineError: Check = ({ text }) => {
  const line = text.split("\n").find((l) => l.startsWith("serial:"));
  return when(!line || !SERIAL_LINE_RE.test(line), "serial line");
};

const missingErrors: Check = ({ map }) =>
  REQUIRED_KEYS.filter((k) => map[k] == null || map[k] === "").map((k) => `missing ${k}`);

const statusError: Check = ({ map }) => when(!!map.status && !STATUS_RE.test(map.status), "status");

const createdError: Check = ({ map }) => when(!!map.created && !CREATED_RE.test(map.created), "created");

const sourceError: Check = ({ map }) =>
  when(typeof map.source === "string" && map.source.length > SOURCE_MAX, "source length");

const commitError: Check = ({ map }) =>
  when(hasKey(map, "commit") && !COMMIT_SUBJECT_RE.test(String(map.commit)), "commit");

const strategyErrors: Check = ({ map }) => when(!parseStrategy(map.strategy), strategyError());

const modeChecks: Check = ({ map }) => modeErrors(map);

const slugError: Check = ({ filename, map }) =>
  when(!!map.name && slugFromFilename(filename) !== map.name, "name/filename slug");

const h1Error: Check = ({ body, map }) => when(!body.trim().startsWith(`# ${map.name}`), "h1 slug");

const reviewChecks: Check = ({ map, previous }) =>
  reviewErrors(map, (previous == null ? null : parseFrontmatter(previous))?.map ?? null, {
    gates: REVIEWS_TO_ENTER,
    review: REVIEW_COMMAND,
  });

const serialNameError: Check = ({ filename, map }) => {
  const fileSerial = SERIAL_PREFIX_RE.exec(filename)?.[1];
  return when(!!fileSerial && !!map.serial && Number(map.serial) !== Number(fileSerial), "serial/filename");
};

/** Checks on the frontmatter and the name, run before the sections are read. */
const HEAD_CHECKS: Check[] = [
  serialLineError,
  missingErrors,
  statusError,
  createdError,
  sourceError,
  commitError,
  strategyErrors,
  modeChecks,
  slugError,
  h1Error,
  reviewChecks,
  serialNameError,
];

/**
 * `fresh` is a new plan: no `[x]`, Previous mistakes required. `previous` is the saved text an
 * update replaces: its Previous mistakes entries must survive unchanged and in order.
 */
export function validatePlan(filename: string, text: string, { fresh = true, previous }: Options = {}): string[] {
  const errors: string[] = when(!FILENAME_RE.test(filename), "filename");
  const fm = parseFrontmatter(text);
  if (fm.error !== undefined) return [...errors, fm.error];
  const doc: Doc = { body: fm.body, filename, fresh, map: fm.map, previous, text };
  errors.push(...HEAD_CHECKS.flatMap((check) => check(doc)));
  const fence = unclosedFenceErrors(text);
  if (fence.length) return [...errors, ...fence];
  const sections = sectionBodies(fm.body);
  errors.push(...BODY_CHECKS.flatMap((check) => check(doc, sections)));
  return [...new Set(errors)];
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
  const under = (abs: string) => {
    const rel = p.relative(top, canonicalPath(abs, p));
    return rel && !rel.startsWith("..") && !p.isAbsolute(rel);
  };
  const trim = (m: string) => m.replace(TRAILING_PUNCT_RE, "");
  const source = String(text);
  const absolute = allMatches(ABSOLUTE_PATH, source).map(trim).filter(under);
  const relative = allMatches(RELATIVE_PATH, source)
    .map(trim)
    .filter((m) => EXTENSION_RE.test(m))
    .map((m) => p.resolve(top, m))
    .filter(under);
  return [...new Set([...absolute, ...relative])];
}
