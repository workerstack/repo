/** One lesson file: its globs, parse, canonical render and validation. */
import path from "node:path";

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
  HEADING_MARK,
  KEYS,
  MAX_LINES,
  MD_EXT,
  MISTAKE,
  NOT_FOUND,
  REGEX_SPECIAL_RE,
  SECTIONS,
  SLUG_RE,
  TRAILING_NL_RE,
} from "./lessons.constants.ts";
import type { Frontmatter, Lesson, LessonBody, LessonFields, ParsedLesson } from "./lessons.types.ts";

/** Glob to an anchored RegExp over repo-relative posix paths. `**` spans dirs; `*` and `?` stay in one segment. */
export function globToRegExp(glob: unknown): RegExp {
  const g = String(glob);
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

function readFrontmatter(text: unknown): Frontmatter | null {
  // A Windows checkout with core.autocrlf turns a committed lesson's LF into CRLF.
  const s = String(text).replace(BOM_RE, "").replaceAll("\r\n", "\n");

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

function isStringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function jsonList(raw: string): string[] | null {
  try {
    const v: unknown = JSON.parse(raw);

    return isStringList(v) ? v : null;
  } catch {
    return null;
  }
}

/** The `# ` title and the first plain line under it, with what is missing. */
function headOf(lines: string[]): Pick<LessonBody, "errors" | "summary" | "title"> {
  const errors: string[] = [];
  const h1Line = lines.find((l) => H1_RE.test(l));

  if (h1Line === undefined) errors.push("start the body with a # title line");
  const h1 = h1Line === undefined ? NOT_FOUND : lines.indexOf(h1Line);
  const title = h1Line?.slice(H1_PREFIX.length).trim() ?? "";
  const summary = (lines.slice(h1 + 1).find((l) => l.trim() !== "" && !l.startsWith(HEADING_MARK)) ?? "").trim();
  const firstH2 = lines.findIndex((l) => l.startsWith(H2_PREFIX));

  if (summary === "" || (firstH2 !== NOT_FOUND && lines.indexOf(summary) > firstH2))
    errors.push("put a one-line summary under the # title");

  return { errors, summary, title };
}

/** The trimmed text between the heading at line `at` and line `end`. */
function sectionText(lines: string[], at: number, end: number): string {
  return lines
    .slice(at + 1, end)
    .join("\n")
    .trim();
}

/** Each `## ` heading in order, and the trimmed text under each. */
function sectionsOf(lines: string[]): { names: string[]; sections: Map<string, string> } {
  const h2 = lines.flatMap((l, i): { i: number; name: string }[] =>
    l.startsWith(H2_PREFIX) ? [{ i, name: l.slice(H2_PREFIX.length).trim() }] : [],
  );

  return {
    names: h2.map(({ name }) => name),
    sections: new Map(h2.map(({ i, name }, k) => [name, sectionText(lines, i, h2[k + 1]?.i ?? lines.length)])),
  };
}

/** Split the body into title, summary, and the Mistake/Fix sections. */
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

  return { errors, fix, mistake, summary: head.summary, title: head.title };
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
export function parseLesson(text: unknown, { defaults }: { defaults?: Record<string, string> } = {}): ParsedLesson {
  const fm = readFrontmatter(text);

  if (fm === null) return { errors: [FM_MISSING], ok: false };
  const unknownKeys = Object.keys(fm.map).filter((k) => !KEYS.includes(k));
  const fields = readFields({ ...defaults, ...fm.map });
  const body = readBody(fm.body);
  const errors = [...unknownKeys.map((k) => `unknown frontmatter key: ${k}`), ...fieldErrors(fields), ...body.errors];
  const { evidence, paths } = fields;

  if (errors.length > 0 || paths === null || evidence === null) return { errors, ok: false };
  const { fix, mistake, summary, title } = body;

  return {
    lesson: {
      evidence,
      fix,
      hits: fields.hits,
      lastHit: fields.lastHit,
      mistake,
      name: fields.name,
      paths,
      summary,
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

${l.summary}

## Mistake
${l.mistake}

## Fix
${l.fix}
`;
}

/** What is wrong with lesson `filename` holding `text`; with `files`, each glob must match one of them. */
export function validateLesson(filename: string, text: unknown, { files }: { files?: string[] } = {}): string[] {
  const lineCount = String(text).replace(TRAILING_NL_RE, "").split("\n").length;

  const errors: string[] =
    lineCount > MAX_LINES
      ? [`lesson is ${lineCount} lines; the cap is ${MAX_LINES} lines, so cut it or split the mistake`]
      : [];

  const parsed = parseLesson(text);

  if (!parsed.ok) return [...errors, ...parsed.errors];
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
