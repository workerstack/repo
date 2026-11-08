#!/usr/bin/env bun
/** Allocate/slugify/validate/write a local plan under .tmp/repo/plans/. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalPath, resolveRoots } from "./workspace-root.ts";
import { matchLessons, type Roots } from "./lessons.ts";
import { parseStrategy, STRATEGIES } from "./strategy.ts";

export const PLAN_DIR = ".tmp/repo/plans";
/** Old unstamped names and new `{serial}-{slug}-{YYYYMMDDTHHMMSSZ}.md`. */
export const FILENAME_RE =
  /^[0-9]+-[a-z0-9]+(-[a-z0-9]+)*(-\d{8}T\d{6}Z)?\.md$/;
export const SERIAL_LINE_RE = /^serial: [1-9][0-9]*$/;
export const STATUS_RE = /^(ready|in-progress|done|blocked)$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const CREATED_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/;
export const FILENAME_STAMP_RE = /-\d{8}T\d{6}Z$/;
/** Conventional Commits subject. Scope optional. Lowercase, no trailing period. */
export const COMMIT_SUBJECT_RE =
  /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([a-z0-9]+(?:-[a-z0-9]+)*\))?: [a-z0-9](?:[a-z0-9 .'/:_,-]*[a-z0-9])?$/;
export const REQUIRED_H2 = [
  "Goal",
  "Context",
  "Constraints",
  "Watch-outs",
  "Steps",
  "Verify",
];
/** Last heading: this plan's own log of mistakes. Required on new plans, append-only on updates. */
export const MISTAKES_H2 = "Previous mistakes";
/** Entry kinds a plan logs. A roadmap adds its own. */
export const PLAN_MISTAKE_SOURCES: readonly string[] = ["feedback", "verify", "review", "premise"];
/** Frontmatter `key: value` lines, values as strings. */
export type FrontmatterMap = Record<string, string>;

/** `## ` heading order and section bodies of a document. */
export interface Sections {
  order: string[];
  bodies: Record<string, string>;
}

export interface MistakeEntry {
  source: string;
  text: string;
  lesson: string | undefined;
  line: string;
}

export type FrontmatterResult =
  | { error: string; map?: undefined; body?: undefined }
  | { error?: undefined; map: FrontmatterMap; body: string };

/**
 * A persist outcome: `ok` with the written file's fields, or not ok with `error` (and `errors` when several).
 * Each side lists the other's fields as `undefined`, so a reader can touch any field before narrowing on `ok`.
 */
export type PersistResult<T> =
  | ({ ok: true; error?: undefined; errors?: undefined } & T)
  | ({ ok: false; error: string; errors?: string[] } & { [K in keyof T]?: undefined });

export type PlanResult = PersistResult<{ path: string; serial: number; slug: string; content: string; filename: string }>;

const BOX_RE = /^( {0,2})(\d+(?:\.\d+){0,2}) \[([ xX])\] (.+)$/;
const LEAF_ID_RE = /^\d+\.\d+(?:\.\d+)?$/;

export function slugify(name: unknown) {
  let s = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > 50) {
    s = s.slice(0, 50).replace(/-+$/g, "");
  }
  if (!s) s = "unnamed";
  if (s.endsWith(".lock")) {
    s = s.slice(0, -5).replace(/-+$/g, "") || "unnamed";
  }
  return s;
}

export function utcDateTime(d = new Date()) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function utcDate(d = new Date()) {
  return utcDateTime(d).slice(0, 10);
}

export function compactCreatedStamp(created: unknown) {
  return String(created).replace(/[-:]/g, "");
}

export function slugFromFilename(filename: unknown) {
  return String(filename)
    .replace(/\.md$/, "")
    .replace(/^[0-9]+-/, "")
    .replace(FILENAME_STAMP_RE, "");
}

const PLAN_NAME_RE = /^\s*PLAN_NAME:\s*(\S.*?)\s*$/;

/** The `PLAN_NAME:` line outside a code fence and above the first `## `, with its index; null when absent. */
function planNameLine(lines: string[]) {
  const { fenced } = fencedLineSet(lines);
  for (const [at, line] of lines.entries()) {
    if (fenced.has(at)) continue;
    if (line.startsWith("## ")) return null;
    const m = PLAN_NAME_RE.exec(line);
    if (m) return { at, name: m[1] ?? "" };
  }
  return null;
}

export function extractPlanName(content: unknown) {
  return planNameLine(String(content).split("\n"))?.name ?? "";
}

/** `content` without its `PLAN_NAME:` line and the blank lines after it, wherever it sits above the first `## `. */
export function stripPlanName(content: unknown) {
  const lines = String(content).split("\n");
  const found = planNameLine(lines);
  if (!found) return lines.join("\n");
  const rest = lines.slice(found.at + 1);
  const blanks = rest.findIndex((l) => l.trim() !== "");
  lines.splice(found.at, 1 + (blanks === -1 ? rest.length : blanks));
  return lines.join("\n");
}

export function extractH1(content: unknown) {
  const m = String(content).match(/^#\s+(.+?)\s*$/m);
  return m ? (m[1] ?? "").trim() : "";
}

export function nextSerial(plansDir: string) {
  let next = 1;
  if (!fs.existsSync(plansDir)) return next;
  for (const b of fs.readdirSync(plansDir)) {
    if (!b.endsWith(".md")) continue;
    const m = b.match(/^([0-9]+)-/);
    if (!m) continue;
    const n = parseInt(m[1] ?? "", 10);
    if (Number.isFinite(n) && n >= next) next = n + 1;
  }
  return next;
}

function stripFrontmatter(text: unknown) {
  const s = String(text).replace(/^\uFEFF/, "");
  if (!s.startsWith("---\n")) return s;
  const end = s.indexOf("\n---\n", 4);
  if (end === -1) return s;
  return s.slice(end + 5);
}

export function extractCommit(content: unknown) {
  const text = String(content).replace(/^\uFEFF/, "");
  if (text.startsWith("---\n")) {
    const fm = parseFrontmatter(text);
    if (fm.error === undefined && Object.prototype.hasOwnProperty.call(fm.map, "commit")) {
      return fm.map.commit;
    }
  }
  const m = text.match(/^commit:\s*(.*?)\s*$/m);
  return m ? m[1] : undefined;
}

function stripCommitLine(content: unknown) {
  return String(content).replace(/^commit:\s*.*\n/m, "");
}

/** Index of the first `strategy:` line outside a code fence, else -1. */
function strategyLineAt(lines: string[]) {
  const { fenced } = fencedLineSet(lines);
  return lines.findIndex((l, i) => !fenced.has(i) && /^strategy:/.test(l));
}

/** The `strategy:` value a save sends, in its frontmatter or as a body line; undefined when absent. */
export function extractStrategy(content: unknown) {
  const text = String(content).replace(/^\uFEFF/, "");
  if (text.startsWith("---\n")) {
    const fm = parseFrontmatter(text);
    if (fm.error === undefined && Object.prototype.hasOwnProperty.call(fm.map, "strategy")) return fm.map.strategy;
  }
  const lines = text.split("\n");
  const at = strategyLineAt(lines);
  return at === -1 ? undefined : (lines[at] ?? "").replace(/^strategy:\s*/, "").trim();
}

/** `content` without its first `strategy:` line outside a code fence. */
export function stripStrategyLine(content: unknown) {
  const lines = String(content).split("\n");
  const at = strategyLineAt(lines);
  if (at !== -1) lines.splice(at, 1);
  return lines.join("\n");
}

/** `strategy` must be one of the three values. */
export const STRATEGY_ERROR = `strategy: ${STRATEGIES.join("|")}`;

export interface FrontmatterInput {
  serial: number;
  slug: string;
  source?: unknown;
  body: string;
  created?: string;
  commit?: string | undefined;
  strategy?: string | undefined;
}

export function injectFrontmatter({
  serial,
  slug,
  source,
  body,
  created,
  commit,
  strategy,
}: FrontmatterInput) {
  const src = String(source || "").slice(0, 120);
  let rest = stripFrontmatter(body).replace(/^\s+/, "");
  if (!rest.startsWith("# ")) {
    rest = `# ${slug}\n\n` + rest;
  } else {
    rest = rest.replace(/^# .+/, `# ${slug}`);
  }
  const commitLine =
    commit != null && commit !== "" ? `commit: ${commit}\n` : "";
  const strategyLine =
    strategy != null && strategy !== "" ? `strategy: ${strategy}\n` : "";
  return `---
serial: ${serial}
name: ${slug}
status: ready
reviews: 0
created: ${created || utcDateTime()}
source: ${JSON.stringify(src)}
${commitLine}${strategyLine}---

${rest}`;
}

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/**
 * Lines inside CommonMark code fences, fence lines included. A fence closes only on the same
 * character, at least as long, with nothing after it. `unclosed` is the 1-based line of a fence
 * that never closes, else null.
 */
export function fencedLineSet(lines: string[]): { fenced: Set<number>; unclosed: number | null } {
  const fenced = new Set<number>();
  let open: { char: string; length: number; line: number } | null = null;
  for (const [i, line] of lines.entries()) {
    if (open) {
      fenced.add(i);
      const m = FENCE_CLOSE_RE.exec(line);
      const fence = m?.[1] ?? "";
      if (m && fence[0] === open.char && fence.length >= open.length) open = null;
      continue;
    }
    const m = FENCE_OPEN_RE.exec(line);
    const fence = m?.[1] ?? "";
    if (!m || (fence[0] === "`" && line.slice(line.indexOf(fence) + fence.length).includes("`"))) continue;
    fenced.add(i);
    open = { char: fence.charAt(0), length: fence.length, line: i + 1 };
  }
  return { fenced, unclosed: open ? open.line : null };
}

export function unclosedFenceErrors(text: unknown) {
  const { unclosed } = fencedLineSet(String(text).split("\n"));
  return unclosed ? [`unclosed code fence at line ${unclosed}: close it with the same fence`] : [];
}

/** `## ` sections outside code fences, in order, with each body. */
export function sectionBodies(text: string): Sections {
  const lines = text.split("\n");
  const { fenced } = fencedLineSet(lines);
  const h2: { title: string; index: number; end: number }[] = [];
  let offset = 0;
  lines.forEach((line, i) => {
    const m = !fenced.has(i) && /^## (.+)$/.exec(line);
    if (m) h2.push({ title: (m[1] ?? "").trim(), index: offset, end: offset + line.length + 1 });
    offset += line.length + 1;
  });
  const bodies: Record<string, string> = {};
  for (const [i, cur] of h2.entries()) {
    const end = h2[i + 1]?.index ?? text.length;
    bodies[cur.title] = text.slice(cur.end, end);
  }
  return { order: h2.map((h) => h.title), bodies };
}

export const USAGE_H2 = "Usage";

/**
 * `## Usage` shows what a person or agent types and sees: required right after Goal on a fresh
 * save, optional on an update to a file saved without it, and never prose alone.
 */
export function usageErrors(order: string[], bodies: Record<string, string>, { fresh }: { fresh: boolean }) {
  const at = order.indexOf(USAGE_H2);
  if (at === -1) {
    return fresh
      ? ['missing ## Usage after ## Goal: show what a person types and sees, before and after, in fenced blocks, or one "No visible change:" line']
      : [];
  }
  const errors: string[] = [];
  if (order[at - 1] !== "Goal") errors.push("## Usage must come right after ## Goal");
  const body = bodies[USAGE_H2] || "";
  const lines = body.split("\n");
  const hasFence = fencedLineSet(lines).fenced.size > 0;
  if (!hasFence && !lines.some((l) => l.startsWith("No visible change:"))) {
    errors.push('## Usage needs a fenced example or a "No visible change:" line');
  }
  return errors;
}

export const CARD_LABELS = ["WHAT", "WHY", "RISK", "TOUCH", "DONE"] as const;
export const CARD_WIDTH = 120;
const CARD_PAD = 7;
const CARD_LABEL_RE = new RegExp(`^(?:${CARD_LABELS.join("|")})\\b`);

/**
 * The card a person reads first: the 5 lines after the `# ` title and one blank line, labels in
 * order padded to 7 columns, each line at most 120 characters. One message per failing line.
 */
export function cardErrors(body: string) {
  const lines = body.replace(/^\s+/, "").split("\n");
  const block: string[] = [];
  if (lines[1] === "") {
    for (const line of lines.slice(2)) {
      if (line.trim() === "" || line.startsWith("## ")) break;
      block.push(line);
    }
  }
  if (!block.some((l) => CARD_LABEL_RE.test(l))) {
    return [`start with the 5-line card after the title: ${CARD_LABELS.join(", ")}`];
  }
  const errors: string[] = [];
  CARD_LABELS.forEach((label, i) => {
    const n = i + 1;
    const line = block[i] ?? "";
    const pad = label.padEnd(CARD_PAD);
    if (!new RegExp(`^${label}\\b`).test(line)) errors.push(`card line ${n} must start with ${label}`);
    else if (!line.startsWith(pad) || !/\S/.test(line.charAt(CARD_PAD))) {
      errors.push(`card line ${n} (${label}) needs its text at column ${CARD_PAD + 1}: "${pad}<text>"`);
    }
    const length = [...line].length;
    if (length > CARD_WIDTH) errors.push(`card line ${n} (${label}) is ${length} characters; the limit is ${CARD_WIDTH}`);
  });
  if (block.length > CARD_LABELS.length) errors.push("the card is 5 lines; end it with a blank line after DONE");
  return errors;
}

export const PLAN_LINE_CAP = 100;

/** Lines above the first `## Previous mistakes` outside a fence, frontmatter included; the whole file when absent. */
function linesAboveMistakes(text: string) {
  const lines = text.replace(/\n$/, "").split("\n");
  const { fenced } = fencedLineSet(lines);
  const at = lines.findIndex((l, i) => !fenced.has(i) && l === `## ${MISTAKES_H2}`);
  return at === -1 ? lines.length : at;
}

/**
 * A plan past 100 lines above Previous mistakes is a roadmap. A fresh save is held to the cap;
 * an update only when it grows past both the cap and the saved file, so legacy plans stay editable.
 */
export function capErrors(text: string, { fresh, previous }: { fresh: boolean; previous?: string | null }) {
  const n = linesAboveMistakes(text);
  const ceiling = fresh || previous == null ? PLAN_LINE_CAP : Math.max(PLAN_LINE_CAP, linesAboveMistakes(previous));
  return n > ceiling
    ? [`${n} lines above ## ${MISTAKES_H2}, the cap is ${PLAN_LINE_CAP}; split it into a roadmap (/write-roadmap)`]
    : [];
}

export interface PlanBox {
  id: string;
  mark: string;
  text: string;
}

export interface PlanPhase extends PlanBox {
  leaves: PlanBox[];
}

/** Checkbox lines outside code fences, in file order. */
export function planBoxes(text: string): PlanBox[] {
  const lines = text.split("\n");
  const { fenced } = fencedLineSet(lines);
  const boxes: PlanBox[] = [];
  for (const [i, line] of lines.entries()) {
    const m = !fenced.has(i) && BOX_RE.exec(line);
    if (m) boxes.push({ id: m[2] ?? "", mark: m[3] ?? "", text: m[4] ?? "" });
  }
  return boxes;
}

/** Phases (`N [ ]`) in order, each with the leaves under it. */
export function planPhases(boxes: PlanBox[]): PlanPhase[] {
  return boxes
    .filter((b) => /^\d+$/.test(b.id))
    .map((p) => ({ ...p, leaves: boxes.filter((b) => LEAF_ID_RE.test(b.id) && b.id.startsWith(p.id + ".")) }));
}

const PRINCIPLE_READ_RE = /^read\s+(?:`principle-[\w-]+`(?:\s*(?:,|and)\s*)?)+\.?$/i;

function readsOnly(phase: PlanPhase) {
  return phase.leaves.length > 0 && phase.leaves.every((l) => PRINCIPLE_READ_RE.test(l.text.trim()));
}

/**
 * A phase that only reads principles gates nothing: each read belongs in the phase it gates. A
 * fresh save is denied; an update only when the saved file had no such phase.
 */
export function readPhaseErrors(phases: PlanPhase[], { fresh, previous }: { fresh: boolean; previous?: string | null }) {
  const offending = phases.filter(readsOnly);
  if (!offending.length) return [];
  if (!fresh && previous != null && planPhases(planBoxes(previous)).some(readsOnly)) return [];
  return offending.map((p) => `phase ${p.id} only reads principles; move each read into the phase it gates`);
}

const PARALLEL_RE = /\(parallel:([^)]*)\)\s*$/;

/** The files a `(parallel: a, b)` phase declares, `\` read as `/`, as written; null when not parallel. */
export function parallelFiles(phase: PlanBox): string[] | null {
  const m = PARALLEL_RE.exec(phase.text);
  if (!m) return null;
  return (m[1] ?? "").split(/[,\s]+/).filter(Boolean).map((f) => f.replace(/\\/g, "/"));
}

/**
 * Adjacent `parallel:` phases form a group that may run at once, so their declared files must be
 * disjoint. A group needs two or more phases, and each phase must declare its files.
 */
export function parallelErrors(phases: PlanPhase[]) {
  const errors: string[] = [];
  const groups: { id: string; files: string[] }[][] = [];
  let run: { id: string; files: string[] }[] = [];
  for (const p of [...phases, null]) {
    const files = p && parallelFiles(p);
    if (p && files) {
      run.push({ id: p.id, files });
      continue;
    }
    if (run.length) groups.push(run);
    run = [];
  }
  for (const group of groups) {
    for (const [i, a] of group.entries()) {
      if (group.length === 1) errors.push(`phase ${a.id} is parallel alone; parallel needs two or more adjacent phases`);
      if (!a.files.length) errors.push(`phase ${a.id} is parallel with no files; list the files it writes after parallel:`);
      for (const b of group.slice(i + 1)) {
        for (const f of new Set(a.files.filter((x) => b.files.includes(x)))) {
          errors.push(`parallel phases ${a.id} and ${b.id} both list ${f}; parallel phases need disjoint files`);
        }
      }
    }
  }
  return errors;
}

function parseFrontmatter(text: string): FrontmatterResult {
  if (!text.startsWith("---\n")) return { error: "missing frontmatter" };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { error: "unterminated frontmatter" };
  const raw = text.slice(4, end);
  const map: FrontmatterMap = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([a-z]+):(?:\s+(.*))?$/);
    if (m?.[1] === undefined) continue;
    let v = m[2] ?? "";
    if (v.startsWith('"') && v.endsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(v);
        v = typeof parsed === "string" ? parsed : v;
      } catch {
        v = v.slice(1, -1);
      }
    }
    map[m[1]] = v;
  }
  return { map, body: text.slice(end + 5) };
}

const REVIEWS_RE = /^(0|[1-9][0-9]*)$/;
/** Statuses a plan may enter only after that many settled `/review-plan` rounds. */
const REVIEWS_TO_ENTER: Record<string, number> = { "in-progress": 1 };

/**
 * `reviews` counts settled review rounds: well-formed, never removed or lowered, and gating entry to
 * a status. `gates` maps a status to the rounds it needs; `review` is the command the deny names.
 */
export function reviewErrors(
  map: FrontmatterMap,
  prev: FrontmatterMap | null,
  { gates, review }: { gates: Record<string, number>; review: string },
): string[] {
  const has = Object.prototype.hasOwnProperty.call(map, "reviews");
  if (has && !REVIEWS_RE.test(String(map.reviews))) {
    return ["reviews must be a whole number with no sign or leading zero, e.g. reviews: 1"];
  }
  const count = has ? Number(map.reviews) : 0;
  const errors: string[] = [];
  if (prev && Object.prototype.hasOwnProperty.call(prev, "reviews")) {
    if (!has) errors.push(`keep reviews: ${prev.reviews} in the frontmatter; the review count cannot be removed`);
    else if (count < Number(prev.reviews)) errors.push(`reviews cannot go down (saved ${prev.reviews}, got ${count})`);
  }
  const need = map.status === undefined ? undefined : gates[map.status];
  if (need && (!prev || prev.status !== map.status) && count < need) {
    errors.push(
      `status ${map.status} needs reviews: ${need} or more; run ${review}, settle its findings, and bump reviews in that save`,
    );
  }
  return errors;
}

/** `(none)` or one `- {source}: {what was wrong} → {what changed}` line per entry. */
export function parseMistakes(sectionText: unknown, sources: readonly string[]): { entries: MistakeEntry[]; errors: string[] } {
  const re = new RegExp(
    `^- (${sources.join("|")}): (.+?) → (.+?)(?: \\(lesson: ([a-z0-9]+(?:-[a-z0-9]+)*)\\))?$`,
  );
  const lines = String(sectionText ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 1 && lines[0] === "(none)") return { entries: [], errors: [] };
  if (!lines.length) return { entries: [], errors: ["## Previous mistakes is empty; write (none)"] };
  const entries: MistakeEntry[] = [];
  const errors: string[] = [];
  for (const line of lines) {
    const m = line.match(re);
    if (!m) {
      errors.push(
        `Previous mistakes entry must be "- {${sources.join("|")}}: {what was wrong} → {what changed}": ${line}`,
      );
      continue;
    }
    entries.push({ source: m[1] ?? "", text: `${m[2]} → ${m[3]}`, lesson: m[4], line });
  }
  return { entries, errors };
}

/**
 * Errors in a `## Previous mistakes` log given a document's heading order and section bodies:
 * last and once, required when `fresh`, well-formed, and append-only against `previous` (the saved
 * document's order and bodies). `kind` names the document in the deny.
 */
export function mistakeLogErrors(
  order: string[],
  bodies: Record<string, string>,
  {
    fresh,
    previous,
    sources,
    kind,
  }: { fresh: boolean; previous?: Sections | null; sources: readonly string[]; kind: string },
): string[] {
  const errors: string[] = [];
  const at = order.indexOf(MISTAKES_H2);
  if (at !== -1 && (at !== order.length - 1 || order.lastIndexOf(MISTAKES_H2) !== at)) {
    errors.push("## Previous mistakes must be the last heading, once");
  }
  if (at === -1 && fresh) {
    errors.push(`missing ## Previous mistakes; end a new ${kind} with it and (none)`);
  }
  const mistakes: { entries: MistakeEntry[]; errors: string[] } = at === -1 ? { entries: [], errors: [] } : parseMistakes(bodies[MISTAKES_H2], sources);
  errors.push(...mistakes.errors);
  if (previous && previous.order.includes(MISTAKES_H2)) {
    const current = mistakes.entries.map((e) => e.line);
    parseMistakes(previous.bodies[MISTAKES_H2], sources).entries.forEach((e, i) => {
      if (current[i] !== e.line) {
        errors.push(`Previous mistakes is append-only; keep this entry unchanged: ${e.line}`);
      }
    });
  }
  return errors;
}

/**
 * `fresh` is a new plan: no `[x]`, Previous mistakes required. `previous` is the saved text an
 * update replaces: its Previous mistakes entries must survive unchanged and in order.
 */
export function validatePlan(
  filename: string,
  text: string,
  { fresh = true, previous }: { fresh?: boolean; previous?: string | null } = {},
): string[] {
  const errors: string[] = [];
  if (!FILENAME_RE.test(filename)) errors.push("filename");
  const fm = parseFrontmatter(text);
  if (fm.error !== undefined) {
    errors.push(fm.error);
    return errors;
  }
  const { map, body } = fm;
  const serialLine = text.split("\n").find((l) => l.startsWith("serial:"));
  if (!serialLine || !SERIAL_LINE_RE.test(serialLine)) errors.push("serial line");
  for (const k of ["serial", "name", "status", "created", "source"]) {
    if (map[k] == null || map[k] === "") errors.push(`missing ${k}`);
  }
  if (map.status && !STATUS_RE.test(map.status)) errors.push("status");
  if (map.created && !CREATED_RE.test(map.created)) errors.push("created");
  if (typeof map.source === "string" && map.source.length > 120) {
    errors.push("source length");
  }
  if (
    Object.prototype.hasOwnProperty.call(map, "commit") &&
    !COMMIT_SUBJECT_RE.test(String(map.commit))
  ) {
    errors.push("commit");
  }
  if (!parseStrategy(map.strategy)) errors.push(STRATEGY_ERROR);
  const slugFromName = map.name;
  if (slugFromName && slugFromFilename(filename) !== slugFromName) {
    errors.push("name/filename slug");
  }
  if (!body.trim().startsWith(`# ${slugFromName}`)) errors.push("h1 slug");
  const prevFm = previous == null ? null : parseFrontmatter(previous);
  errors.push(
    ...reviewErrors(map, prevFm?.map ?? null, {
      gates: REVIEWS_TO_ENTER,
      review: "/review-plan {n}",
    }),
  );
  const fileSerial = filename.match(/^(\d+)-/);
  if (fileSerial && map.serial && Number(map.serial) !== Number(fileSerial[1])) {
    errors.push("serial/filename");
  }
  const fence = unclosedFenceErrors(text);
  if (fence.length) return [...errors, ...fence];
  const { order: allOrder, bodies } = sectionBodies(body);
  errors.push(
    ...mistakeLogErrors(allOrder, bodies, {
      fresh,
      previous: previous == null ? null : sectionBodies(stripFrontmatter(previous)),
      sources: PLAN_MISTAKE_SOURCES,
      kind: "plan",
    }),
  );
  errors.push(...usageErrors(allOrder, bodies, { fresh }));
  if (fresh) errors.push(...cardErrors(body));
  errors.push(...capErrors(text, { fresh, previous }));
  const order = allOrder.filter((h) => h !== MISTAKES_H2 && h !== USAGE_H2);
  const firstSix = order.slice(0, REQUIRED_H2.length);
  if (REQUIRED_H2.some((h, i) => firstSix[i] !== h)) errors.push("heading order");
  const extra = order.filter((h) => !REQUIRED_H2.includes(h));
  if (extra.length) errors.push("extra h2");
  const goal = (bodies.Goal || "").trim();
  const sentences = goal.split(/(?<=[.!?])(?:\s+|$)/).filter((s) => s.trim());
  if (!goal || sentences.length < 1 || sentences.length > 3) errors.push("goal");
  for (const h of ["Context", "Constraints", "Watch-outs"]) {
    const b = (bodies[h] || "").trim();
    if (!b) errors.push(`${h} empty`);
    else if (!/^(?:[-*] |\(none\))/m.test(b)) errors.push(`${h} bullets`);
  }
  const boxes = planBoxes(text);
  if (fresh && boxes.some((b) => b.mark !== " ")) errors.push("fresh [x]");
  const leaves = boxes.filter((b) => LEAF_ID_RE.test(b.id));
  if (leaves.length < 1) errors.push("no N.M leaf");
  const phases = planPhases(boxes);
  for (const p of phases) {
    if (!boxes.some((b) => b.id.startsWith(p.id + "."))) errors.push(`phase ${p.id} leaf`);
  }
  errors.push(...readPhaseErrors(phases, { fresh, previous }));
  errors.push(...parallelErrors(phases));
  const last = phases[phases.length - 1];
  if (last) {
    if (!/^Verify\b/i.test(last.text) && last.id !== String(phases.length)) {
      errors.push("verify last phase");
    }
  }
  return [...new Set(errors)];
}

const ABSOLUTE_PATH = /(?<![\w.:\\/-])(?:[A-Za-z]:[\\/]|\/)[^\s`'"()<>,;]+/g;
/** A repo-relative path: two or more segments, the last with an extension, not the tail of an absolute path or a URL. */
const RELATIVE_PATH = /(?<![\w.:\\/@-])[\w.@-]+(?:[\\/][\w.@-]+)+/g;

/**
 * Paths under `ws` (the root) that `text` names: absolute as written (either separator, any case on Windows, any
 * spelling of `ws`: a symlink, an 8.3 name), then repo-relative ones resolved against `ws`. Paths under
 * `<ws>/.worktrees/<name>/` count like any other. A sibling dir that shares the prefix does not.
 */
export function workspacePaths(ws: string, text: unknown, p = path): string[] {
  const top = canonicalPath(p.resolve(ws), p);
  const under = (abs: string) => {
    const rel = p.relative(top, canonicalPath(abs, p));
    return rel && !rel.startsWith("..") && !p.isAbsolute(rel);
  };
  const trim = (m: string) => m.replace(/[.:]+$/, "");
  const source = String(text);
  const absolute = (source.match(ABSOLUTE_PATH) || []).map(trim).filter(under);
  const relative = (source.match(RELATIVE_PATH) || [])
    .map(trim)
    .filter((m) => /\.[A-Za-z0-9]+$/.test(m))
    .map((m) => p.resolve(top, m))
    .filter(under);
  return [...new Set([...absolute, ...relative])];
}

/** Lessons matching files a new plan names, held by the checkout of each file, that Watch-outs does not cite. */
function uncitedLessons(roots: Roots, text: string) {
  const files = [...new Set([roots.root, roots.checkout].flatMap((top) => workspacePaths(top, text)))];
  if (!files.length) return [];
  const watch = sectionBodies(stripFrontmatter(text)).bodies["Watch-outs"] || "";
  return matchLessons({ roots, files }).filter((r) => !watch.includes(r.file));
}

/** `head` (frontmatter ending in `---\n`) with `key: value` set; unchanged when `value` is undefined. */
function setHeadKey(head: string, key: string, value: string | undefined) {
  if (value === undefined) return head;
  const line = new RegExp(`^${key}:.*$`, "m");
  return line.test(head)
    ? head.replace(line, () => `${key}: ${value}`)
    : head.replace(/\n---\n$/, () => `\n${key}: ${value}\n---\n`);
}

/** Body-only revision (PLAN_NAME, no frontmatter): keep the saved frontmatter and slug. */
function withSavedFrontmatter(previous: string, raw: string) {
  const fm = parseFrontmatter(previous);
  // Nothing to keep: validation of the bare body names the missing frontmatter.
  if (fm.error !== undefined) return raw;
  const head = previous.slice(0, previous.length - fm.body.length);
  const nextHead = setHeadKey(setHeadKey(head, "commit", extractCommit(raw)), "strategy", extractStrategy(raw));
  let rest = stripStrategyLine(stripCommitLine(stripPlanName(raw))).replace(/^\s+/, "");
  rest = rest.startsWith("# ") ? rest.replace(/^# .+/, `# ${fm.map.name}`) : `# ${fm.map.name}\n\n${rest}`;
  return `${nextHead}\n${rest}`;
}

/**
 * Rewrite of a saved plan: same file and serial, `[x]` allowed, Previous mistakes append-only.
 * Validates only. The host writes `content`: a write here first makes Claude Code refuse the
 * Write as modified since read.
 */
export function preparePlanUpdate({
  workspaceRoot,
  filePath,
  content,
}: {
  workspaceRoot?: string;
  filePath: string;
  content?: unknown;
}): PlanResult {
  const ws = workspaceRoot || resolveRoots().root;
  const abs = path.resolve(ws, filePath);
  const filename = path.basename(abs);
  const previous = fs.readFileSync(abs, "utf8");
  const text = String(content || "").replace(/^﻿/, "");
  const fence = unclosedFenceErrors(text);
  if (fence.length) return { ok: false, error: fence.join("; "), errors: fence };
  const full = text.startsWith("---\n") ? text : withSavedFrontmatter(previous, text);
  const errors = validatePlan(filename, full, { fresh: false, previous });
  if (errors.length) {
    return { ok: false, error: errors.join("; "), errors };
  }
  return {
    ok: true,
    path: path.relative(ws, abs).split(path.sep).join("/"),
    serial: Number(filename.match(/^(\d+)-/)?.[1]), // validatePlan accepted the filename, so the serial prefix is there
    slug: slugFromFilename(filename),
    content: full,
    filename,
  };
}

export function persistPlan({
  workspaceRoot,
  checkout,
  content,
  source,
  created,
}: {
  workspaceRoot?: string;
  checkout?: string;
  content?: unknown;
  source?: string;
  created?: string;
} = {}): PlanResult {
  const ws = workspaceRoot || resolveRoots().root;
  // Lesson citations read tracked lessons, which live in the checkout that holds each file the plan names.
  const lessonRoots = { root: ws, checkout: checkout || ws, cwd: ws };
  const raw = String(content || "");
  // Line numbers in this deny count from what the caller sent.
  const fence = unclosedFenceErrors(raw);
  if (fence.length) return { ok: false, error: fence.join("; "), errors: fence };
  const planName = extractPlanName(raw) || extractH1(stripFrontmatter(stripPlanName(raw)));
  const slug = slugify(planName);
  const commit = extractCommit(raw);
  const strategy = extractStrategy(raw);
  const body = stripStrategyLine(stripCommitLine(stripPlanName(raw)));
  const plansDir = path.join(ws, PLAN_DIR);
  fs.mkdirSync(plansDir, { recursive: true });
  const createdAt =
    created && DATETIME_RE.test(created) ? created : utcDateTime();
  const stamp = compactCreatedStamp(createdAt);
  let serial = nextSerial(plansDir);
  let filename = `${serial}-${slug}-${stamp}.md`;
  let dest = path.join(plansDir, filename);
  let tries = 0;
  while (fs.existsSync(dest) && tries < 5) {
    serial += 1;
    filename = `${serial}-${slug}-${stamp}.md`;
    dest = path.join(plansDir, filename);
    tries += 1;
  }
  if (fs.existsSync(dest)) {
    return { ok: false, error: "serial collision" };
  }
  const goalMatch = stripFrontmatter(body).match(/## Goal\n([\s\S]*?)\n## /);
  const sourceText = String(
    source ||
      planName ||
      (goalMatch ? (goalMatch[1] ?? "").trim().replace(/\s+/g, " ") : slug),
  ).slice(0, 120);
  const full = injectFrontmatter({
    serial,
    slug,
    source: sourceText,
    body,
    created: createdAt,
    commit,
    strategy,
  });
  const errors = validatePlan(filename, full);
  for (const r of uncitedLessons(lessonRoots, full)) {
    errors.push(`cite this matched lesson in Watch-outs: ${r.file} (${r.summary})`);
  }
  if (errors.length) {
    return { ok: false, error: errors.join("; "), errors };
  }
  fs.writeFileSync(dest, full);
  return {
    ok: true,
    path: `${PLAN_DIR}/${filename}`,
    serial,
    slug,
    content: full,
    filename,
  };
}

function main() {
  try {
    const wsIdx = process.argv.indexOf("--workspace");
    const workspaceRoot =
      (wsIdx >= 0 ? process.argv[wsIdx + 1] : undefined) ?? resolveRoots().root;
    const content = fs.readFileSync(0, "utf8");
    const result = persistPlan({ workspaceRoot, content });
    if (!result.ok) {
      process.stderr.write((result.error || "invalid plan") + "\n");
      return 1;
    }
    process.stdout.write(
      JSON.stringify({
        serial: result.serial,
        path: result.path,
        absPath: path.resolve(workspaceRoot, result.path),
        filename: result.filename,
      }) + "\n",
    );
    return 0;
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  process.exit(main());
}
