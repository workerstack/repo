#!/usr/bin/env bun
/** Allocate/validate/write a new roadmap under .tmp/repo/roadmaps/; validate an update of a saved one. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveRoots } from "./workspace-root.ts";
import { parseStrategy } from "./strategy.ts";
import {
  type FrontmatterMap,
  type PersistResult,
  capErrors,
  cardErrors,
  compactCreatedStamp,
  FILENAME_RE,
  MISTAKES_H2,
  mistakeLogErrors,
  PLAN_DIR,
  PLAN_MISTAKE_SOURCES,
  reviewErrors,
  sectionBodies,
  slugify,
  STRATEGY_ERROR,
  extractMode,
  extractStrategy,
  modeErrors,
  stripModeLine,
  stripStrategyLine,
  unclosedFenceErrors,
  USAGE_H2,
  usageErrors,
  utcDateTime,
} from "./persist-plan.ts";

export const ROADMAP_DIR = ".tmp/repo/roadmaps";
export const ROADMAP_FILENAME_RE =
  /^[0-9]+-[a-z0-9]+(-[a-z0-9]+)*-\d{8}T\d{6}Z\.md$/;
const STATUS_RE = /^(draft|locked|in-progress|done|blocked)$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const REQUIRED_H2 = [
  "Goal",
  "Context",
  "Decisions",
  "Order",
  "Watch-outs",
  "Verify",
];
/** A roadmap also logs `slice`: what a child plan found that changed the program. */
const ROADMAP_MISTAKE_SOURCES: readonly string[] = [...PLAN_MISTAKE_SOURCES, "slice"];
/** Statuses a roadmap may enter only after that many settled `/review-roadmap` rounds. */
const REVIEWS_TO_ENTER: Record<string, number> = { locked: 1 };
const SLICE_RE = /^(?: {0,2})(\d+) \[([ xX])\] Title: (.+)$/;
const KEY_RE = /^ {2,8}(Goal|Why|Location): (.*)$/;
/** A roadmap with no `## Goal` is a pointer roadmap: the card, one line per slice, Verify. */
const POINTER_H2 = ["Order", "Verify"];
const POINTER_LINE_CAP = 60;
const POINTER_CAP_FIX = "move detail into the slice plans";
const POINTER_SLICE_RE = /^(?: {0,2})(\d+) \[[ xX]\] (.*)$/;
const POINTER_TEXT_RE = /^(.+?): (.+)$/;
const LOCATION_LINE_RE = /^\s+Location: (.*)$/;
const DRIVE_RE = /^[A-Za-z]:[\\/]/;
/** A saved roadmap's frontmatter and the text after it. */
interface Split {
  body: string;
  map: FrontmatterMap;
}

/** One `Title:` slice of the Order section. */
interface Slice {
  title: string;
  goal: string;
  why: string;
  location: string;
  hasGoal: boolean;
  hasWhy: boolean;
  hasLocation: boolean;
}

/** One line of a pointer roadmap's Order: `N [ ] {title}: {one sentence}`, then an optional Location. */
interface PointerSlice {
  n: string;
  ok: boolean;
  location: string | null;
}

interface Preamble {
  body: string;
  status: string;
  reviews: string | undefined;
  strategy: string | undefined;
  mode: string | undefined;
  fullFrontmatter: boolean;
  name: string;
}

export type RoadmapResult = PersistResult<{ path: string; serial: number; filename: string; content: string }>;

const BOX_RE = /^(?: {0,2})(\d+(?:\.\d+){0,2}) \[([ xX])\] (.+)$/;

/**
 * A slice's Location: any absolute path, or a plan file under `.tmp/repo/plans/`. A drive-letter
 * path is absolute under every platform's rules, so a roadmap written on Windows checks the same on posix.
 */
export function locationOk(loc: string, p: path.PlatformPath = path) {
  const norm = String(loc || "").replace(/\\/g, "/");
  if (p.isAbsolute(loc) || DRIVE_RE.test(loc)) return true;
  const prefix = `${PLAN_DIR}/`;
  if (!norm.startsWith(prefix)) return false;
  const base = norm.slice(prefix.length);
  return !base.includes("/") && FILENAME_RE.test(base);
}

function sentences(text: unknown) {
  return String(text)
    .trim()
    .split(/(?<=[.!?])(?:\s+|$)/)
    .filter((s) => s.trim());
}

function stripFrontmatter(text: unknown): Split {
  const s = String(text).replace(/^\uFEFF/, "");
  if (!s.startsWith("---\n")) return { body: s, map: {} };
  const end = s.indexOf("\n---\n", 4);
  if (end === -1) return { body: s, map: {} };
  const map: FrontmatterMap = {};
  for (const line of s.slice(4, end).split("\n")) {
    const m = line.match(/^([a-z]+):\s*(.*)$/);
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
  return { body: s.slice(end + 5), map };
}

function preamble(raw: string): Preamble {
  const stripped = stripFrontmatter(raw);
  let text = stripped.body.replace(/^\s+/, "");
  let status = stripped.map.status || "";
  let reviews: string | undefined = stripped.map.reviews;
  const nameMatch = text.match(/^ROADMAP_NAME:\s*(.+)\s*$/m);
  text = text.replace(/^ROADMAP_NAME:\s*.+\n/m, "");
  const statusLine = text.match(/^status:\s*(\S+)\s*$/m);
  if (statusLine) {
    if (!status) status = statusLine[1] ?? "";
    text = text.replace(/^status:\s*\S+\s*\n/m, "");
  }
  const reviewsLine = text.match(/^reviews:\s*(\S+)\s*$/m);
  if (reviewsLine) {
    if (reviews == null) reviews = reviewsLine[1] ?? "";
    text = text.replace(/^reviews:\s*\S+\s*\n/m, "");
  }
  const strategy = stripped.map.strategy ?? extractStrategy(text);
  text = stripStrategyLine(text);
  const mode = stripped.map.mode ?? extractMode(text);
  text = stripModeLine(text);
  const h1 = text.match(/^#\s+(.+)\s*$/m);
  return {
    body: text,
    status,
    reviews,
    strategy,
    mode,
    // A sent frontmatter is the whole frontmatter: a missing key there is dropped, not kept.
    fullFrontmatter: stripped.body !== String(raw).replace(/^\uFEFF/, ""),
    name: nameMatch ? (nameMatch[1] ?? "").trim() : h1 ? (h1[1] ?? "").trim() : "",
  };
}


function parseSlices(orderBody: unknown): Slice[] {
  const slices: Slice[] = [];
  let cur: Slice | null = null;
  for (const line of String(orderBody).split("\n")) {
    const head = line.match(SLICE_RE);
    if (head) {
      if (cur) slices.push(cur);
      cur = {
        title: (head[3] ?? "").trim(),
        goal: "",
        why: "",
        location: "",
        hasGoal: false,
        hasWhy: false,
        hasLocation: false,
      };
      continue;
    }
    if (!cur) continue;
    const key = line.match(KEY_RE);
    if (!key) continue;
    if (key[1] === "Goal") {
      cur.goal = (key[2] ?? "").trim();
      cur.hasGoal = true;
    } else if (key[1] === "Why") {
      cur.why = (key[2] ?? "").trim();
      cur.hasWhy = true;
    } else {
      cur.location = (key[2] ?? "").trim();
      cur.hasLocation = true;
    }
  }
  if (cur) slices.push(cur);
  return slices;
}

function parsePointerSlices(orderBody: string): PointerSlice[] {
  const slices: PointerSlice[] = [];
  for (const line of orderBody.split("\n")) {
    const head = line.match(POINTER_SLICE_RE);
    if (head) {
      const text = (head[2] ?? "").trim().match(POINTER_TEXT_RE);
      const words = text ? (text[1] ?? "").split(/\s+/).filter(Boolean).length : 0;
      const ok = !!text && words >= 2 && words <= 6 && sentences(text[2]).length === 1;
      slices.push({ n: head[1] ?? "", ok, location: null });
      continue;
    }
    const cur = slices[slices.length - 1];
    if (!cur || !line.trim()) continue;
    const loc = line.match(LOCATION_LINE_RE);
    // A slice is one line; only a Location line may follow it.
    if (loc && cur.location === null) cur.location = (loc[1] ?? "").trim();
    else cur.ok = false;
  }
  return slices;
}

/** A pointer roadmap: no Usage, only Order and Verify, one-line slices, the 60-line cap. */
function pointerErrors(
  text: string,
  body: string,
  allOrder: string[],
  bodies: Record<string, string>,
  { fresh, previous }: { fresh: boolean; previous?: string | null },
) {
  const errors: string[] = [];
  if (fresh) errors.push(...cardErrors(body));
  const order = allOrder.filter((h) => h !== MISTAKES_H2);
  for (const h of order) {
    if (!POINTER_H2.includes(h)) {
      errors.push(`a new roadmap has only ## Order, ## Verify and ## ${MISTAKES_H2}; move ## ${h} into the slice plans`);
    }
  }
  const kept = order.filter((h) => POINTER_H2.includes(h));
  if (kept.length !== POINTER_H2.length || POINTER_H2.some((h, i) => kept[i] !== h)) errors.push("heading order");
  const slices = parsePointerSlices(bodies.Order || "");
  if (slices.length < 2) errors.push("slices");
  for (const slice of slices) {
    if (!slice.ok) errors.push(`slice ${slice.n} needs "N [ ] {title, 2–6 words}: {one sentence}"`);
    if (slice.location !== null && !locationOk(slice.location)) errors.push("location");
  }
  errors.push(...capErrors(text, { fresh, previous, cap: POINTER_LINE_CAP, fix: POINTER_CAP_FIX, skip: LOCATION_LINE_RE }));
  return errors;
}

/** The old shape roadmaps saved before pointers keep: Goal, Usage, Context, Decisions, Title/Goal/Why slices, Watch-outs. */
function legacyErrors(allOrder: string[], bodies: Record<string, string>, { fresh }: { fresh: boolean }) {
  const errors: string[] = [];
  errors.push(...usageErrors(allOrder, bodies, { fresh }));
  const order = allOrder.filter((h) => h !== MISTAKES_H2 && h !== USAGE_H2);
  if (REQUIRED_H2.some((h, i) => order[i] !== h)) errors.push("heading order");
  if (order.some((h) => !REQUIRED_H2.includes(h))) errors.push("extra h2");
  const goalN = sentences(bodies.Goal || "");
  if (goalN.length < 1 || goalN.length > 3) errors.push("goal");
  for (const h of ["Context", "Decisions", "Watch-outs"]) {
    const b = (bodies[h] || "").trim();
    if (!b || !/^(?:[-*] |\(none\))/m.test(b)) errors.push(`${h.toLowerCase()} bullets`);
  }
  const slices = parseSlices(bodies.Order || "");
  if (slices.length < 2) errors.push("slices");
  for (const slice of slices) {
    const words = slice.title.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 6) errors.push("title");
    if (!slice.hasGoal || sentences(slice.goal).length !== 1) errors.push("slice goal");
    if (!slice.hasWhy || sentences(slice.why).length < 1 || sentences(slice.why).length > 2) {
      errors.push("why");
    }
    if (slice.hasLocation && !locationOk(slice.location)) errors.push("location");
  }
  return errors;
}

export function validateRoadmap(
  filename: string,
  text: string,
  { fresh = false, previous }: { fresh?: boolean; previous?: string | null } = {},
): string[] {
  const errors: string[] = [];
  if (!ROADMAP_FILENAME_RE.test(filename)) errors.push("filename");
  const { body, map } = stripFrontmatter(text);
  if (!map.serial || !map.name || !map.status || !map.created || !map.source) {
    errors.push("frontmatter");
  }
  if (map.status && !STATUS_RE.test(map.status)) errors.push("status");
  if (!parseStrategy(map.strategy)) errors.push(STRATEGY_ERROR);
  errors.push(...modeErrors(map));
  const prev = previous == null ? null : stripFrontmatter(previous);
  // A new roadmap is always a pointer roadmap. An update keeps the saved file's shape, so deleting
  // ## Goal cannot move an old roadmap under other rules; with no saved file the text decides.
  const pointer = fresh || !sectionBodies((prev ?? { body }).body).order.includes("Goal");
  errors.push(...reviewErrors(map, prev ? prev.map : null, { gates: REVIEWS_TO_ENTER, review: "/review-roadmap {n}" }));
  const slug = String(filename)
    .replace(/\.md$/, "")
    .replace(/^[0-9]+-/, "")
    .replace(/-\d{8}T\d{6}Z$/, "");
  if (map.name && map.name !== slug) errors.push("name");
  if (!body.trim().startsWith(`# ${slug}`)) errors.push("h1");
  const fence = unclosedFenceErrors(text);
  if (fence.length) return [...new Set([...errors, ...fence])];
  const { order: allOrder, bodies } = sectionBodies(body);
  errors.push(
    ...mistakeLogErrors(allOrder, bodies, {
      fresh,
      previous: prev && sectionBodies(prev.body),
      sources: ROADMAP_MISTAKE_SOURCES,
      kind: "roadmap",
    }),
  );
  errors.push(
    ...(pointer
      ? pointerErrors(text, body, allOrder, bodies, { fresh, previous })
      : legacyErrors(allOrder, bodies, { fresh })),
  );
  if (fresh && map.status && map.status !== "draft") errors.push("fresh status");
  if (fresh) {
    for (const line of String(bodies.Order || "").split("\n")) {
      const m = line.match(BOX_RE);
      if (m && m[2] !== " ") errors.push("fresh [x]");
    }
  }
  const boxes: string[] = [];
  for (const line of String(bodies.Verify || "").split("\n")) {
    const m = line.match(BOX_RE);
    if (!m) continue;
    if (fresh && m[2] !== " ") errors.push("fresh [x]");
    boxes.push(m[1] ?? "");
  }
  const leaves = boxes.filter((id) => /^\d+\.\d+/.test(id));
  if (leaves.length < 1 || leaves.length > 5) errors.push("verify");
  return [...new Set(errors)];
}

function render(
  serial: number,
  slug: string,
  status: string,
  reviews: string | number | undefined,
  created: string,
  source: unknown,
  strategy: string | undefined,
  mode: string | undefined,
  body: string,
) {
  let rest = body.replace(/^\s+/, "");
  if (!rest.startsWith("# ")) rest = `# ${slug}\n\n${rest}`;
  else rest = rest.replace(/^# .+/, `# ${slug}`);
  return `---
serial: ${serial}
name: ${slug}
status: ${status}
${reviews == null ? "" : `reviews: ${reviews}\n`}created: ${created}
source: ${JSON.stringify(String(source).slice(0, 120))}
${strategy ? `strategy: ${strategy}\n` : ""}${mode === undefined ? "" : `mode: ${mode}\n`}---

${rest}`;
}

function sourceOf(pre: Preamble, slug: string) {
  const goal = pre.body.match(/## Goal\n([\s\S]*?)\n## /);
  return String(
    pre.name || (goal ? (goal[1] ?? "").trim().replace(/\s+/g, " ") : slug),
  ).slice(0, 120);
}

/**
 * Rewrite of a saved roadmap: same file and serial, saved frontmatter kept unless sent.
 * Validates only. The host writes `content`: a write here first makes Claude Code refuse the
 * Write as modified since read.
 */
export function prepareRoadmapUpdate({
  workspaceRoot,
  filePath,
  content,
}: {
  workspaceRoot?: string;
  filePath: string;
  content?: unknown;
}): RoadmapResult {
  const ws = workspaceRoot || resolveRoots().root;
  const abs = path.resolve(ws, filePath);
  const filename = path.basename(abs);
  const previous = fs.readFileSync(abs, "utf8");
  const fence = unclosedFenceErrors(String(content || ""));
  if (fence.length) return { ok: false, error: fence.join("; "), errors: fence };
  const pre = preamble(String(content || ""));
  const prev = stripFrontmatter(previous).map;
  const serial = parseInt(filename.split("-")[0] ?? "", 10);
  const slug = slugFromFile(filename);
  const createdAt = prev.created && DATETIME_RE.test(prev.created) ? prev.created : utcDateTime();
  const reviews = pre.reviews ?? (pre.fullFrontmatter ? undefined : prev.reviews);
  const strategy = pre.strategy ?? (pre.fullFrontmatter ? undefined : prev.strategy);
  const mode = pre.mode ?? (pre.fullFrontmatter ? undefined : prev.mode);
  const full = render(serial, slug, pre.status || prev.status || "draft", reviews, createdAt, prev.source || sourceOf(pre, slug), strategy, mode, pre.body);
  const errors = validateRoadmap(filename, full, { fresh: false, previous });
  if (errors.length) return { ok: false, error: errors.join("; "), errors };
  return {
    ok: true,
    path: path.relative(ws, abs).split(path.sep).join("/"),
    serial,
    filename,
    content: full,
  };
}

export function persistRoadmap({
  workspaceRoot,
  content,
  created,
}: { workspaceRoot?: string; content?: unknown; created?: string } = {}): RoadmapResult {
  const ws = workspaceRoot || resolveRoots().root;
  const dir = path.join(ws, ROADMAP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const fence = unclosedFenceErrors(String(content || ""));
  if (fence.length) return { ok: false, error: fence.join("; "), errors: fence };
  const pre = preamble(String(content || ""));
  const slug = slugify(pre.name);
  const createdAt = created && DATETIME_RE.test(created) ? created : utcDateTime();
  const stamp = compactCreatedStamp(createdAt);
  let serial = nextSerial(dir);
  let filename = `${serial}-${slug}-${stamp}.md`;
  let dest = path.join(dir, filename);
  let tries = 0;
  while (fs.existsSync(dest) && tries < 5) {
    serial += 1;
    filename = `${serial}-${slug}-${stamp}.md`;
    dest = path.join(dir, filename);
    tries += 1;
  }
  const full = render(serial, slug, pre.status || "draft", 0, createdAt, sourceOf(pre, slug), pre.strategy, pre.mode, pre.body);
  const errors = validateRoadmap(filename, full, { fresh: true });
  if (errors.length) return { ok: false, error: errors.join("; "), errors };
  fs.writeFileSync(dest, full);
  return {
    ok: true,
    path: `${ROADMAP_DIR}/${filename}`,
    serial,
    filename,
    content: full,
  };
}

function slugFromFile(filename: unknown) {
  return String(filename)
    .replace(/\.md$/, "")
    .replace(/^[0-9]+-/, "")
    .replace(/-\d{8}T\d{6}Z$/, "");
}

function nextSerial(dir: string) {
  let next = 1;
  if (!fs.existsSync(dir)) return next;
  for (const b of fs.readdirSync(dir)) {
    const m = b.match(/^([0-9]+)-/);
    if (!m) continue;
    const n = parseInt(m[1] ?? "", 10);
    if (Number.isFinite(n) && n >= next) next = n + 1;
  }
  return next;
}

function main() {
  try {
    const wsIdx = process.argv.indexOf("--workspace");
    const workspaceRoot = (wsIdx >= 0 ? process.argv[wsIdx + 1] : undefined) ?? resolveRoots().root;
    const content = fs.readFileSync(0, "utf8");
    const result = persistRoadmap({ workspaceRoot, content });
    if (!result.ok) {
      process.stderr.write((result.error || "invalid roadmap") + "\n");
      return 1;
    }
    process.stdout.write(JSON.stringify({ serial: result.serial, path: result.path, absPath: path.resolve(workspaceRoot, result.path) }) + "\n");
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
