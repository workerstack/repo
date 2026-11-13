/** One lesson file: its globs, parse, canonical render and validation. */
import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import {
  BOM_RE,
  DATE_RE,
  FM_CLOSE,
  FM_LINE_RE,
  FM_MISSING,
  FM_OPEN,
  GLOB_TOKENS,
  H1_PREFIX,
  H1_RE,
  FIX,
  H2_PREFIX,
  KEYS,
  MAX_FIX,
  MAX_MISTAKE,
  MAX_TITLE,
  MD_EXT,
  MISTAKE,
  NOT_FOUND,
  REGEX_SPECIAL_RE,
  SECTIONS,
  SLUG_RE,
} from "./lessons.constants.ts";
import type { Frontmatter, Lesson, LessonBody, LessonFields, ParsedLesson } from "./lessons.types.ts";

/** Glob to an anchored RegExp over repo-relative posix paths. `**` spans dirs; `*` and `?` stay in one segment. */
export function globToRegExp(glob: string): RegExp {
  const g = glob;
  let re = "";
  let i = 0;

  while (i < g.length) {
    const c = g.charAt(i);

    const [token, source] = GLOB_TOKENS.find(([t]) => g.startsWith(t, i)) ?? [
      c,
      c.replaceAll(REGEX_SPECIAL_RE, "\\$&"),
    ];

    re += source;
    i += token.length;
  }

  return new RegExp(`^${re}$`);
}

function readFrontmatter(text: string): Frontmatter | null {
  // A Windows checkout with core.autocrlf turns a committed lesson's LF into CRLF.
  const s = text.replace(BOM_RE, "").replaceAll("\r\n", "\n");

  if (!s.startsWith(FM_OPEN)) return null;
  const end = s.indexOf(FM_CLOSE, FM_OPEN.length);

  if (end === NOT_FOUND) return null;
  const map: Record<string, string> = {};

  for (const line of s.slice(FM_OPEN.length, end).split("\n")) {
    const m = FM_LINE_RE.exec(line);

    if (m === null) continue;
    const [, key, value] = [...m] /* both groups match whenever the pattern does */ as [string, string, string];
    map[key] = value.trim();
  }

  return { body: s.slice(end + FM_CLOSE.length), map };
}

function jsonList(raw: string): string[] | null {
  return tryJson(z.array(z.string()), raw) ?? null;
}

/** The `# ` title, and what is wrong with it or with a plain line between it and the first `## `. */
function headOf(lines: string[]): Pick<LessonBody, "errors" | "title"> {
  const errors: string[] = [];
  const h1Line = lines.find((l) => H1_RE.test(l));

  if (h1Line === undefined) errors.push("start the body with a # title line");
  const h1 = h1Line === undefined ? NOT_FOUND : lines.indexOf(h1Line);
  const title = h1Line?.slice(H1_PREFIX.length).trim() ?? "";
  const firstH2 = lines.findIndex((l) => l.startsWith(H2_PREFIX));
  const between = lines.slice(h1 + 1, firstH2 === NOT_FOUND ? undefined : firstH2);

  if (h1Line !== undefined && between.some((l) => l.trim() !== ""))
    errors.push("drop the line under the # title; put its point in the title or ## Mistake");

  return { errors, title };
}

/** The trimmed text between the heading at line `at` and line `end`. */
function sectionText(lines: string[], at: number, end: number): string {
  return lines
    .slice(at + 1, end)
    .join("\n")
    .trim();
}

/** Each `## ` heading in order, and the trimmed text under each. */
function sectionsOf(lines: string[]) {
  const h2 = lines.flatMap((l, i): { i: number; name: string }[] =>
    l.startsWith(H2_PREFIX) ? [{ i, name: l.slice(H2_PREFIX.length).trim() }] : [],
  );

  return {
    names: h2.map(({ name }) => name),
    sections: new Map(h2.map(({ i, name }, k) => [name, sectionText(lines, i, h2[k + 1]?.i ?? lines.length)])),
  };
}

/** Split the body into the title and the Mistake/Fix sections. */
function readBody(body: string): LessonBody {
  const lines = body.split("\n");
  const head = headOf(lines);
  const { names, sections } = sectionsOf(lines);
  const errors = [...head.errors];

  for (const need of SECTIONS) {
    if (!names.includes(need)) errors.push(`missing ## ${need}`);
    else if (sections.get(need) === "") errors.push(`## ${need} is empty`);
  }

  if (names.length !== SECTIONS.length || names.some((n, k) => n !== SECTIONS[k]))
    errors.push("use only ## Mistake then ## Fix as section headings");
  const fix = sections.get(FIX) ?? "";
  const mistake = sections.get(MISTAKE) ?? "";

  for (const [what, text, cap, advice] of [
    ["title", head.title, MAX_TITLE, "state the rule shorter"],
    [`## ${MISTAKE}`, mistake, MAX_MISTAKE, "keep only what went wrong"],
    [`## ${FIX}`, fix, MAX_FIX, "keep only what to do"],
  ] as const)
    if (text.length > cap) errors.push(`${what} is ${text.length} chars; the cap is ${cap}, so ${advice}`);

  return { errors, fix, mistake, title: head.title };
}

function readFields(map: Record<string, string>): LessonFields {
  return {
    evidence: jsonList(map.evidence ?? "[]"),
    hits: Number(map.hits),
    lastHit: map["last-hit"] ?? "",
    name: map.name ?? "",
    paths: jsonList(map.paths ?? ""),
  };
}

function fieldErrors(f: LessonFields): string[] {
  const errors: string[] = [];

  if (f.paths === null || f.paths.length === 0)
    errors.push('paths must list at least one glob, e.g. paths: ["src/**"]');

  if (f.evidence === null) errors.push('evidence must be a JSON list, e.g. evidence: ["plan 16"]');

  if (!Number.isInteger(f.hits) || f.hits < 1) errors.push("hits must be a whole number ≥ 1");

  if (!DATE_RE.test(f.lastHit)) errors.push("last-hit must be YYYY-MM-DD");

  if (!SLUG_RE.test(f.name)) errors.push("name must be the lowercase-hyphen slug of the filename");

  return errors;
}

/** Parse a lesson file. `defaults` fills missing hits and last-hit (a first write). */
export function parseLesson(text: string, { defaults }: { defaults?: Record<string, string> } = {}): ParsedLesson {
  const fm = readFrontmatter(text);

  if (fm === null) return { errors: [FM_MISSING], ok: false };
  const unknownKeys = Object.keys(fm.map).filter((k) => !KEYS.includes(k));
  const fields = readFields({ ...defaults, ...fm.map });
  const body = readBody(fm.body);
  const errors = [...unknownKeys.map((k) => `unknown frontmatter key: ${k}`), ...fieldErrors(fields), ...body.errors];
  const { evidence, paths } = fields;

  if (errors.length > 0 || paths === null || evidence === null) return { errors, ok: false };
  const { fix, mistake, title } = body;

  return {
    lesson: {
      evidence,
      fix,
      hits: fields.hits,
      lastHit: fields.lastHit,
      mistake,
      name: fields.name,
      paths,
      title,
    },
    ok: true,
  };
}

export function renderLesson(l: Lesson): string {
  return `---
name: ${l.name}
paths: ${JSON.stringify(l.paths)}
hits: ${l.hits}
last-hit: ${l.lastHit}
evidence: ${JSON.stringify(l.evidence)}
---

# ${l.title}

## Mistake
${l.mistake}

## Fix
${l.fix}
`;
}

/** What is wrong with lesson `filename` holding `text`; with `files`, each glob must match one of them. */
export function validateLesson(filename: string, text: string, { files }: { files?: string[] } = {}): string[] {
  const errors: string[] = [];
  const parsed = parseLesson(text);

  if (!parsed.ok) return parsed.errors;
  const slug = path.basename(filename, MD_EXT);

  if (parsed.lesson.name !== slug) errors.push(`name ${parsed.lesson.name} must match the filename ${slug}`);

  return files === undefined ? errors : [...errors, ...globErrors(parsed.lesson.paths, files)];
}

/** One error per glob of `paths` that matches none of `files`. */
function globErrors(paths: string[], files: string[]): string[] {
  return paths
    .filter((glob) => !files.some((f) => globToRegExp(glob).test(f)))
    .map((glob) => `paths glob ${glob} matches no file; point it at code that exists`);
}
