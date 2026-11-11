#!/usr/bin/env bun
/** Lessons: one committed file per repeat mistake under .repo/lessons/, plus a generated index. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { stamp } from "../sync/header.ts";
import { OWNED_MODE } from "../sync/write.constants.ts";
import { writeOwned } from "../sync/write.ts";
import { canonicalPath, resolveRoots } from "./workspace-root.ts";
import { mainCheckoutWriteReason, managedLessonsDir } from "./worktree-guards.ts";

export const LESSONS_DIR = ".repo/lessons";
export const INDEX_NAME = "INDEX.md";
export const MAX_LINES = 60;
export const MAX_EVIDENCE = 5;
export const DEFAULT_CAP = 10;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = ["name", "paths", "hits", "last-hit", "evidence"];
const SKIP_WALK = new Set([".git", "node_modules", ".tmp"]);
const USAGE = "usage: bun repo lessons match <file...> | hit <slug> --evidence <text> | rm <slug> | index | check";

/** One parsed lesson file. */
export type Lesson = {
  name: string;
  paths: string[];
  hits: number;
  lastHit: string;
  evidence: string[];
  title: string;
  summary: string;
  mistake: string;
  fix: string;
};

export type ParsedLesson = { ok: true; lesson: Lesson } | { ok: false; errors: string[] };

/** One INDEX.md row. */
export type IndexRow = {
  file: string;
  paths: string[];
  hits: number;
  lastHit: string;
  summary: string;
};

/** The roots `resolveRoots` returns. */
export type Roots = {
  root: string;
  checkout: string;
  cwd: string;
};

export type LessonResult =
  | { ok: true; path: string; content: string; error?: undefined }
  | { ok: false; error: string; path?: undefined; content?: undefined };
export type HitResult =
  | { ok: true; path: string; hits: number; error?: undefined }
  | { ok: false; error: string; path?: undefined; hits?: undefined };
export type RemoveResult = { ok: true; error?: undefined } | { ok: false; error: string };

function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function toPosix(p: string) {
  return p.split(path.sep).join("/");
}

function lessonsDir(ws: string) {
  return path.join(ws, LESSONS_DIR);
}

function lessonPath(ws: string, slug: string) {
  return path.join(lessonsDir(ws), `${slug}.md`);
}

/** Glob to an anchored RegExp over repo-relative posix paths. `**` spans dirs; `*` and `?` stay in one segment. */
export function globToRegExp(glob: unknown): RegExp {
  let re = "";
  const g = String(glob);
  for (let i = 0; i < g.length; i++) {
    const c = g.charAt(i);
    if (c === "*" && g[i + 1] === "*") {
      if (g[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

function readFrontmatter(text: unknown): { map: Record<string, string>; body: string } | null {
  // A Windows checkout with core.autocrlf turns a committed lesson's LF into CRLF.
  const s = String(text).replace(/^﻿/, "").replaceAll("\r\n", "\n");
  if (!s.startsWith("---\n")) return null;
  const end = s.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const map: Record<string, string> = {};
  for (const line of s.slice(4, end).split("\n")) {
    const m = line.match(/^([a-z-]+):\s*(.*)$/);
    if (m) {
      map[m[1] /* group 1 is set whenever the pattern matches */ as string] = (
        m[2] /* group 2 is set whenever the pattern matches */ as string
      ).trim();
    }
  }
  return { body: s.slice(end + 5), map };
}

function jsonList(raw: string): string[] | null {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
  } catch {
    return null;
  }
}

/** Split the body into title, summary, and the Mistake/Fix sections. */
function readBody(body: unknown) {
  const errors: string[] = [];
  const lines = String(body).split("\n");
  const h1 = lines.findIndex((l) => /^# \S/.test(l));
  if (h1 === -1) errors.push("start the body with a # title line");
  const title = h1 === -1 ? "" : (lines[h1] /* findIndex returned a valid index */ as string).slice(2).trim();
  const summary = (lines.slice(h1 + 1).find((l) => l.trim() && !l.startsWith("#")) || "").trim();
  const firstH2 = lines.findIndex((l) => l.startsWith("## "));
  if (!summary || (firstH2 !== -1 && lines.indexOf(summary) > firstH2))
    errors.push("put a one-line summary under the # title");

  const h2 = lines.map((l, i) => ({ i, l })).filter(({ l }) => l.startsWith("## "));
  const names = h2.map(({ l }) => l.slice(3).trim());
  const sections: Record<string, string> = {};
  h2.forEach(({ l, i }, k) => {
    sections[l.slice(3).trim()] = lines
      .slice(i + 1, h2[k + 1]?.i ?? lines.length)
      .join("\n")
      .trim();
  });
  for (const need of ["Mistake", "Fix"]) {
    if (!names.includes(need)) errors.push(`missing ## ${need}`);
    else if (!sections[need]) errors.push(`## ${need} is empty`);
  }
  if (names.length !== 2 || names[0] !== "Mistake" || names[1] !== "Fix")
    errors.push("use only ## Mistake then ## Fix as section headings");

  return { errors, fix: sections.Fix || "", mistake: sections.Mistake || "", summary, title };
}

/** Parse a lesson file. `defaults` fills missing hits and last-hit (a first write). */
export function parseLesson(text: unknown, { defaults }: { defaults?: Record<string, string> } = {}): ParsedLesson {
  const fm = readFrontmatter(text);
  if (!fm) return { errors: ["start with --- frontmatter (name, paths, hits, last-hit, evidence)"], ok: false };
  const errors: string[] = [];
  const map: Record<string, string> = { ...defaults, ...fm.map };
  for (const k of Object.keys(fm.map)) if (!KEYS.includes(k)) errors.push(`unknown frontmatter key: ${k}`);
  const name = map.name ?? "";
  const lastHit = map["last-hit"] ?? "";
  const paths = jsonList(map.paths ?? "");
  if (!paths || !paths.length) errors.push('paths must list at least one glob, e.g. paths: ["src/**"]');
  const evidence = jsonList(map.evidence ?? "[]");
  if (!evidence) errors.push('evidence must be a JSON list, e.g. evidence: ["plan 16"]');
  const hits = Number(map.hits);
  if (!Number.isInteger(hits) || hits < 1) errors.push("hits must be a whole number ≥ 1");
  if (!DATE_RE.test(lastHit)) errors.push("last-hit must be YYYY-MM-DD");
  if (!SLUG_RE.test(name)) errors.push("name must be the lowercase-hyphen slug of the filename");
  const body = readBody(fm.body);
  errors.push(...body.errors);
  if (errors.length || !paths || !evidence) return { errors, ok: false };
  return {
    lesson: {
      evidence,
      fix: body.fix,
      hits,
      lastHit,
      mistake: body.mistake,
      name,
      paths,
      summary: body.summary,
      title: body.title,
    },
    ok: true,
  };
}

export function renderLesson(l: Lesson) {
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

/** Repo-relative files: tracked and untracked-but-not-ignored in git, else a walk. */
export function repoFiles(ws: string): string[] {
  const git = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ws, encoding: "utf8" });
  if (git.status === 0) return git.stdout.split("\n").filter(Boolean);

  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_WALK.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) out.push(toPosix(path.relative(ws, abs)));
    }
  };
  walk(ws);
  return out;
}

export function validateLesson(filename: string, text: unknown, { files }: { files?: string[] } = {}): string[] {
  const errors: string[] = [];
  const lineCount = String(text).replace(/\n$/, "").split("\n").length;
  if (lineCount > MAX_LINES)
    errors.push(`lesson is ${lineCount} lines; the cap is ${MAX_LINES} lines, so cut it or split the mistake`);

  const parsed = parseLesson(text);
  if (!parsed.ok) return [...errors, ...parsed.errors];
  const slug = path.basename(filename, ".md");
  if (parsed.lesson.name !== slug) errors.push(`name ${parsed.lesson.name} must match the filename ${slug}`);
  if (files) {
    for (const glob of parsed.lesson.paths) {
      const re = globToRegExp(glob);
      if (!files.some((f) => re.test(f)))
        errors.push(`paths glob ${glob} matches no file; point it at code that exists`);
    }
  }
  return errors;
}

function lessonFiles(ws: string) {
  const dir = lessonsDir(ws);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".md") && n !== INDEX_NAME)
    .sort();
}

function cell(s: unknown) {
  return String(s).replaceAll(/\s+/g, " ").replaceAll("|", "\\|");
}

/** `pending` maps a lesson filename to text the host is about to write. */
function indexRows(ws: string, pending: Record<string, string> = {}): IndexRow[] {
  const rows: IndexRow[] = [];
  const names = [...new Set([...lessonFiles(ws), ...Object.keys(pending)])].sort();
  for (const name of names) {
    const text = pending[name] ?? fs.readFileSync(path.join(lessonsDir(ws), name), "utf8");
    const parsed = parseLesson(text);
    if (!parsed.ok) continue;
    const l = parsed.lesson;
    rows.push({ file: `${LESSONS_DIR}/${name}`, hits: l.hits, lastHit: l.lastHit, paths: l.paths, summary: l.summary });
  }
  return rows.sort((a, b) => b.hits - a.hits || a.file.localeCompare(b.file));
}

/** The index text, under sync's header line and a blank line, so every writer of it writes the same bytes. */
export function renderIndex(rows: IndexRow[]): string {
  const body = rows.map(
    (r) => `| ${r.file} | ${cell(r.paths.join(", "))} | ${r.hits} | ${r.lastHit} | ${cell(r.summary)} |`,
  );
  const text = [
    "",
    "# Lessons",
    "",
    "| lesson | paths | hits | last-hit | summary |",
    "| --- | --- | --- | --- | --- |",
    ...body,
    "",
  ].join("\n");
  return stamp(`${LESSONS_DIR}/${INDEX_NAME}`, text);
}

function parseIndex(text: unknown): IndexRow[] {
  const rows: IndexRow[] = [];
  for (const line of String(text).split("\n")) {
    if (!line.startsWith(`| ${LESSONS_DIR}/`)) continue;
    const cells = line
      .slice(2, -2)
      .replaceAll("\\|", "\u0000")
      .split(" | ")
      .map((c) => c.replaceAll("\0", "|"));
    if (cells.length !== 5) continue;
    const [file, pathsCell, hits, lastHit, summary] = cells /* five cells checked above */ as [
      string,
      string,
      string,
      string,
      string,
    ];
    rows.push({
      file,
      hits: Number(hits),
      lastHit,
      paths: pathsCell.split(", ").filter(Boolean),
      summary,
    });
  }
  return rows;
}

/**
 * Derived from the lesson files only, so any writer rerunning it converges; temp file then rename, left read-only
 * as sync leaves the files it owns. Throws, naming the index, when it cannot be written.
 */
export function writeIndex({
  workspaceRoot: ws,
  pending,
}: {
  workspaceRoot: string;
  pending?: Record<string, string>;
}): {
  ok: boolean;
  path: string;
} {
  const dir = lessonsDir(ws);
  fs.mkdirSync(dir, { recursive: true });
  const text = renderIndex(indexRows(ws, pending));
  const dest = path.join(dir, INDEX_NAME);
  const error = writeOwned(dest, text, OWNED_MODE);
  if (error !== null) throw new Error(`cannot write ${dest}: ${error}`);
  return { ok: true, path: dest };
}

/** `{ root, checkout, cwd }` standing in for the roots of a lone checkout `ws`. */
function loneRoots(ws: string): Roots {
  const dir = canonicalPath(path.resolve(ws));
  return { checkout: dir, cwd: dir, root: dir };
}

/**
 * The checkout whose lessons govern `file`: the root or the managed worktree holding it, else the caller's
 * `roots.checkout` (an unmanaged linked worktree sits outside the root).
 */
export function holdingCheckout(file: string, roots: Roots): string {
  const dir = managedLessonsDir(file, roots);
  return dir ? path.dirname(path.dirname(dir)) : canonicalPath(path.resolve(roots.checkout));
}

/**
 * Index rows whose globs match any of `files`, by hits then name. Each file is matched against the lessons of the
 * checkout that holds it. Reads INDEX.md only. Pass `roots` (from `resolveRoots`), or `workspaceRoot` for one checkout.
 */
export function matchLessons(
  opts: ({ roots: Roots; workspaceRoot?: undefined } | { roots?: undefined; workspaceRoot: string }) & {
    files: string[];
    cap?: number;
  },
): IndexRow[] {
  const { files, cap = DEFAULT_CAP } = opts;
  const scope = opts.roots ?? loneRoots(opts.workspaceRoot);
  const byHolder = new Map<string, string[]>();
  for (const f of files) {
    const abs = canonicalPath(path.resolve(scope.cwd, f));
    const holder = holdingCheckout(abs, scope);
    const rel = path.relative(holder, abs);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    byHolder.set(holder, [...(byHolder.get(holder) ?? []), toPosix(rel)]);
  }
  const rows = new Map<string, IndexRow>();
  for (const [holder, rels] of byHolder) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(lessonsDir(holder), INDEX_NAME), "utf8");
    } catch {
      continue;
    }
    for (const row of parseIndex(text)) {
      const seen = rows.get(row.file);
      if (row.paths.some((g) => rels.some((f) => globToRegExp(g).test(f))) && (!seen || seen.hits < row.hits))
        rows.set(row.file, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.hits - a.hits || a.file.localeCompare(b.file)).slice(0, cap);
}

/** The refusal text when `ws` is a committed repo's main checkout, else null: lessons change in a worktree. */
function mainCheckoutRefusal(ws: string) {
  return mainCheckoutWriteReason(lessonsDir(ws), resolveRoots({ workspaceRoot: ws }));
}

function writeLesson(ws: string, slug: string, text: string) {
  fs.mkdirSync(lessonsDir(ws), { recursive: true });
  fs.writeFileSync(lessonPath(ws, slug), text);
  writeIndex({ workspaceRoot: ws });
}

/**
 * A Write of `.repo/lessons/{slug}.md`: fill defaults, render canonical, validate, and reindex with
 * the pending text. The host writes the lesson: a write here first makes Claude Code refuse the Write.
 */
export function persistLesson({
  workspaceRoot: ws,
  filePath,
  content,
  today = utcDate(),
}: {
  workspaceRoot: string;
  filePath: string;
  content: unknown;
  today?: string;
}): LessonResult {
  const refusal = mainCheckoutRefusal(ws);
  if (refusal) return { error: refusal, ok: false };
  const abs = path.resolve(ws, filePath);
  const name = path.basename(abs);
  if (path.dirname(abs) !== lessonsDir(ws) || name === INDEX_NAME || !name.endsWith(".md"))
    return { error: `write lessons as ${LESSONS_DIR}/{slug}.md; ${INDEX_NAME} is generated by lessons.ts`, ok: false };

  const slug = name.slice(0, -3);
  if (!SLUG_RE.test(slug)) return { error: `lesson filename must be a lowercase-hyphen slug: ${name}`, ok: false };
  const parsed = parseLesson(content, { defaults: { evidence: "[]", hits: "1", "last-hit": today, name: slug } });
  if (!parsed.ok) return { error: parsed.errors.join("; "), ok: false };
  const text = renderLesson({ ...parsed.lesson, name: slug });
  const errors = validateLesson(name, text, { files: repoFiles(ws) });
  if (errors.length) return { error: errors.join("; "), ok: false };
  writeIndex({ pending: { [name]: text }, workspaceRoot: ws });
  return { content: text, ok: true, path: abs };
}

/** Another occurrence. The same evidence twice counts once, so a retried hit converges. */
export function hitLesson({
  workspaceRoot: ws,
  slug,
  evidence,
  today = utcDate(),
}: {
  workspaceRoot: string;
  slug: string;
  evidence: string;
  today?: string;
}): HitResult {
  const refusal = mainCheckoutRefusal(ws);
  if (refusal) return { error: refusal, ok: false };
  const file = lessonPath(ws, slug);
  if (!fs.existsSync(file)) return { error: `no lesson ${slug}; write ${LESSONS_DIR}/${slug}.md first`, ok: false };
  const parsed = parseLesson(fs.readFileSync(file, "utf8"));
  if (!parsed.ok) return { error: parsed.errors.join("; "), ok: false };
  const l = parsed.lesson;
  if (l.evidence.includes(evidence)) return { hits: l.hits, ok: true, path: file };
  const next = {
    ...l,
    evidence: [...l.evidence, evidence].slice(-MAX_EVIDENCE),
    hits: l.hits + 1,
    lastHit: today,
  };
  writeLesson(ws, slug, renderLesson(next));
  return { hits: next.hits, ok: true, path: file };
}

export function removeLesson({ workspaceRoot: ws, slug }: { workspaceRoot: string; slug: string }): RemoveResult {
  const refusal = mainCheckoutRefusal(ws);
  if (refusal) return { error: refusal, ok: false };
  const file = lessonPath(ws, slug);
  if (!fs.existsSync(file)) return { error: `no lesson ${slug}`, ok: false };
  fs.rmSync(file);
  writeIndex({ workspaceRoot: ws });
  return { ok: true };
}

/** One error per lesson file that breaks the format or whose `paths` match no file; empty without a lessons dir. */
export function lessonProblems(ws: string): string[] {
  const dir = lessonsDir(ws);
  if (!fs.existsSync(dir)) return [];
  const errors: string[] = [];
  const files = repoFiles(ws);
  for (const name of lessonFiles(ws)) {
    for (const e of validateLesson(name, fs.readFileSync(path.join(dir, name), "utf8"), { files }))
      errors.push(`${LESSONS_DIR}/${name}: ${e}`);
  }
  return errors;
}

/** The text of the lessons index for the lesson files under `ws`. */
export function renderLessonsIndex(ws: string): string {
  return renderIndex(indexRows(ws));
}

export function checkLessons({ workspaceRoot: ws }: { workspaceRoot: string }): string[] {
  const dir = lessonsDir(ws);
  if (!fs.existsSync(dir)) return [];
  const errors = lessonProblems(ws);
  let onDisk: string | null = null;
  try {
    onDisk = fs.readFileSync(path.join(dir, INDEX_NAME), "utf8");
  } catch {
    onDisk = null;
  }
  if (onDisk !== renderLessonsIndex(ws))
    errors.push(`${LESSONS_DIR}/${INDEX_NAME} is out of date; run bun repo lessons index inside a worktree`);

  return errors;
}

function fail(msg: string) {
  process.stderr.write(`${msg}\n`);
  return 1;
}

function runLessons(argv: string[], roots: Roots): number {
  const ws = roots.checkout;
  const [cmd, ...rest] = argv;
  if (cmd === "match") {
    if (!rest.length) return fail(USAGE);
    for (const r of matchLessons({ files: rest.map((f) => path.resolve(roots.cwd, f)), roots }))
      process.stdout.write(`${r.file} (hits ${r.hits}): ${r.summary}\n`);

    return 0;
  }
  if (cmd === "hit") {
    const at = rest.indexOf("--evidence");
    const slug = rest[0];
    const evidence = at === -1 ? "" : rest[at + 1];
    if (!slug || slug === "--evidence" || !evidence) return fail(USAGE);
    const r = hitLesson({ evidence, slug, workspaceRoot: ws });
    if (!r.ok) return fail(r.error);
    process.stdout.write(`${LESSONS_DIR}/${slug}.md hits ${r.hits}\n`);
    return 0;
  }
  if (cmd === "rm") {
    if (!rest[0]) return fail(USAGE);
    const r = removeLesson({ slug: rest[0], workspaceRoot: ws });
    return r.ok ? 0 : fail(r.error);
  }
  if (cmd === "index" && !rest.length) {
    const refusal = mainCheckoutRefusal(ws);
    if (refusal) return fail(refusal);
    writeIndex({ workspaceRoot: ws });
    return 0;
  }
  if (cmd === "check" && !rest.length) {
    const errors = checkLessons({ workspaceRoot: ws });
    if (!errors.length) return 0;
    return fail(errors.join("\n"));
  }
  return fail(USAGE);
}

export function main(argv: string[], roots: () => Roots = resolveRoots): number {
  try {
    return runLessons(argv, roots());
  } catch (err) {
    return fail((err /* fs, JSON and the roots lookup throw Errors */ as Error).message);
  }
}
