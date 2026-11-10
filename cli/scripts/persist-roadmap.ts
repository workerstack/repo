#!/usr/bin/env bun
/** Allocate/validate/write a new roadmap under .tmp/repo/roadmaps/; validate an update of a saved one. */
import fs from "node:fs";
import path from "node:path";
import { resolveRoots } from "./workspace-root.ts";
import {
  type FrontmatterMap,
  type PersistResult,
  captured,
  compactCreatedStamp,
  nextSerial,
  slugFromFilename,
  slugify,
  utcDateTime,
} from "./persist-doc.ts";
import { DATETIME_RE, DECIMAL, H1_RE, SOURCE_MAX } from "./persist-doc.constants.ts";
import { extractMode, extractStrategy, stripModeLine, stripStrategyLine } from "./persist-keys.ts";
import { unclosedFenceErrors } from "./persist-sections.ts";
import {
  DRAFT_STATUS,
  GOAL_SECTION_RE,
  ROADMAP_DIR,
  ROADMAP_NAME_RE,
  ROADMAP_NAME_STRIP_RE,
} from "./persist-roadmap.constants.ts";
import { splitFrontmatter, validateRoadmap } from "./persist-roadmap-validate.ts";

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

/** What `render` writes into a roadmap file. */
interface RenderInput {
  serial: number;
  slug: string;
  status: string;
  reviews: string | number | undefined;
  created: string;
  source: unknown;
  strategy: string | undefined;
  mode: string | undefined;
  body: string;
}

/** A leading `key: value` line taken out of text: its value, and the text without the line. */
function takeLine(text: string, key: string): { value: string | undefined; text: string } {
  const found = text.match(new RegExp(`^${key}:\\s*(\\S+)\\s*$`, "m"));
  const rest = found ? text.replace(new RegExp(`^${key}:\\s*\\S+\\s*\\n`, "m"), "") : text;
  return { value: found ? captured(found, 1) : undefined, text: rest };
}

/** The `ROADMAP_NAME:` line's value, else the first heading's. */
function nameOf(named: string, body: string): string {
  const found = named.match(ROADMAP_NAME_RE) ?? body.match(H1_RE);
  return found ? captured(found, 1).trim() : "";
}

function preamble(raw: string): Preamble {
  const stripped = splitFrontmatter(raw);
  const trimmed = stripped.body.replace(/^\s+/, "");
  const status = takeLine(trimmed.replace(ROADMAP_NAME_STRIP_RE, ""), "status");
  const reviews = takeLine(status.text, "reviews");
  const strategy = stripped.map.strategy ?? extractStrategy(reviews.text);
  const unstrategized = stripStrategyLine(reviews.text);
  const mode = stripped.map.mode ?? extractMode(unstrategized);
  const body = stripModeLine(unstrategized);
  return {
    body,
    status: stripped.map.status || status.value || "",
    reviews: stripped.map.reviews ?? reviews.value,
    strategy,
    mode,
    // A sent frontmatter is the whole frontmatter: a missing key there is dropped, not kept.
    fullFrontmatter: stripped.body !== String(raw).replace(/^\uFEFF/, ""),
    name: nameOf(trimmed, body),
  };
}

function render({ serial, slug, status, reviews, created, source, strategy, mode, body }: RenderInput): string {
  const trimmed = body.replace(/^\s+/, "");
  const rest = trimmed.startsWith("# ") ? trimmed.replace(/^# .+/, `# ${slug}`) : `# ${slug}\n\n${trimmed}`;
  const head = [
    `serial: ${serial}`,
    `name: ${slug}`,
    `status: ${status}`,
    ...(reviews == null ? [] : [`reviews: ${reviews}`]),
    `created: ${created}`,
    `source: ${JSON.stringify(String(source).slice(0, SOURCE_MAX))}`,
    ...(strategy ? [`strategy: ${strategy}`] : []),
    ...(mode === undefined ? [] : [`mode: ${mode}`]),
  ];
  return `---\n${head.join("\n")}\n---\n\n${rest}`;
}

function sourceOf(pre: Preamble, slug: string): string {
  const goal = pre.body.match(GOAL_SECTION_RE);
  return String(pre.name || (goal ? captured(goal, 1).trim().replace(/\s+/g, " ") : slug)).slice(0, SOURCE_MAX);
}

/** The saved frontmatter an update keeps for each key it does not send; a full frontmatter drops them. */
function keptKeys(pre: Preamble, prev: FrontmatterMap): Pick<RenderInput, "reviews" | "strategy" | "mode"> {
  const keep = (sent: string | undefined, saved: string | undefined) =>
    sent ?? (pre.fullFrontmatter ? undefined : saved);
  return {
    reviews: keep(pre.reviews, prev.reviews),
    strategy: keep(pre.strategy, prev.strategy),
    mode: keep(pre.mode, prev.mode),
  };
}

const serialOf = (filename: string): number => parseInt(String(filename.split("-")[0]), DECIMAL);

/** The file an update saves: the sent body under the saved file's name, serial and kept keys. */
function updatedFile(filename: string, content: unknown, previous: string): string {
  const pre = preamble(String(content || ""));
  const prev = splitFrontmatter(previous).map;
  const slug = slugFromFilename(filename);
  return render({
    serial: serialOf(filename),
    slug,
    status: pre.status || prev.status || DRAFT_STATUS,
    created: prev.created && DATETIME_RE.test(prev.created) ? prev.created : utcDateTime(),
    source: prev.source || sourceOf(pre, slug),
    ...keptKeys(pre, prev),
    body: pre.body,
  });
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
  const full = updatedFile(filename, content, previous);
  const errors = validateRoadmap(filename, full, { fresh: false, previous });
  if (errors.length) return { ok: false, error: errors.join("; "), errors };
  const rel = path.relative(ws, abs).split(path.sep).join("/");
  return { ok: true, path: rel, serial: serialOf(filename), filename, content: full };
}

/** A new roadmap's next serial, file name and text. */
function newFile(dir: string, pre: Preamble, created: string | undefined) {
  const slug = slugify(pre.name);
  const createdAt = created && DATETIME_RE.test(created) ? created : utcDateTime();
  const serial = nextSerial(dir, "");
  const filename = `${serial}-${slug}-${compactCreatedStamp(createdAt)}.md`;
  const full = render({
    serial,
    slug,
    status: pre.status || DRAFT_STATUS,
    reviews: 0,
    created: createdAt,
    source: sourceOf(pre, slug),
    strategy: pre.strategy,
    mode: pre.mode,
    body: pre.body,
  });
  return { serial, filename, full };
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
  const { serial, filename, full } = newFile(dir, pre, created);
  const errors = validateRoadmap(filename, full, { fresh: true });
  if (errors.length) return { ok: false, error: errors.join("; "), errors };
  fs.writeFileSync(path.join(dir, filename), full);
  return { ok: true, path: `${ROADMAP_DIR}/${filename}`, serial, filename, content: full };
}
