#!/usr/bin/env bun
/** Allocate/validate/write a new roadmap under .repo/roadmaps/; validate an update of a saved one. */
import fs from "node:fs";
import path from "node:path";

import { AGENT_DEFAULTS } from "../agent-defaults.constants.ts";
import { firstNonEmpty } from "./first-non-empty.ts";
import { DECIMAL, H1_RE, SOURCE_MAX } from "./persist-doc.constants.ts";
import {
  type FrontmatterMap,
  type PersistResult,
  captured,
  compactCreatedStamp,
  createdAtOf,
  injectFrontmatter,
  nextSerial,
  slugFromFilename,
  slugify,
  stripBom,
} from "./persist-doc.ts";
import {
  extractApproval,
  extractRetiredMode,
  extractStrategy,
  stripApprovalLine,
  stripStrategyLine,
} from "./persist-keys.ts";
import { splitFrontmatter, validateRoadmap } from "./persist-roadmap-validate.ts";
import {
  DRAFT_STATUS,
  GOAL_SECTION_RE,
  ROADMAP_DIR,
  ROADMAP_NAME_RE,
  ROADMAP_NAME_STRIP_RE,
} from "./persist-roadmap.constants.ts";
import { type Rewrite, persistSource, refused, rewriteTarget, saveTarget } from "./persist-save.ts";
import { unclosedFenceErrors } from "./persist-sections.ts";
import type { Strategy } from "./strategy.types.ts";

const LEADING_SPACE_RE = /^\s+/;

type Preamble = {
  body: string;
  status: string;
  reviews: string | undefined;
  strategy: string | undefined;
  approval: string | undefined;
  mode: string | undefined;
  fullFrontmatter: boolean;
  name: string;
};

export type RoadmapResult = PersistResult<{ path: string; serial: number; filename: string; content: string }>;

/** What `render` writes into a roadmap file. */
type RenderInput = {
  serial: number;
  slug: string;
  status: string;
  reviews: string | number | undefined;
  created: string;
  source: string;
  strategy: string | undefined;
  approval: string | undefined;
  mode?: string | undefined;
  body: string;
};

/** A leading `key: value` line taken out of text: its value, and the text without the line. */
function takeLine(text: string, key: string) {
  const found = text.match(new RegExp(`^${key}:[ \\t]*(\\S+)\\s*$`, "m"));
  const rest = found === null ? text : text.replace(new RegExp(`^${key}:[ \\t]*\\S+\\s*\\n`, "m"), "");

  return { text: rest, value: found === null ? undefined : captured(found, 1) };
}

/** The `ROADMAP_NAME:` line's value, else the first heading's. */
function nameOf(named: string, body: string): string {
  const found = named.match(ROADMAP_NAME_RE) ?? body.match(H1_RE);

  return found === null ? "" : captured(found, 1).trim();
}

function preamble(raw: string): Preamble {
  const stripped = splitFrontmatter(raw);
  const trimmed = stripped.body.replace(LEADING_SPACE_RE, "");
  const status = takeLine(trimmed.replace(ROADMAP_NAME_STRIP_RE, ""), "status");
  const reviews = takeLine(status.text, "reviews");
  const strategy = stripped.map.strategy ?? extractStrategy(reviews.text);
  const unstrategized = stripStrategyLine(reviews.text);
  const approval = stripped.map.approval ?? extractApproval(unstrategized);
  const body = stripApprovalLine(unstrategized);

  return {
    approval,
    body,
    // A sent frontmatter is the whole frontmatter: a missing key there is dropped, not kept.
    fullFrontmatter: stripped.body !== stripBom(raw),
    mode: stripped.map.mode ?? extractRetiredMode(unstrategized),
    name: nameOf(trimmed, body),
    reviews: stripped.map.reviews ?? reviews.value,
    status: firstNonEmpty(stripped.map.status, status.value) ?? "",
    strategy,
  };
}

function render({
  serial,
  slug,
  status,
  reviews,
  created,
  source,
  strategy,
  approval,
  mode,
  body,
}: RenderInput): string {
  const head = [
    `serial: ${serial}`,
    `name: ${slug}`,
    `status: ${status}`,
    ...(reviews == null ? [] : [`reviews: ${reviews}`]),
    `created: ${created}`,
    `source: ${JSON.stringify(source.slice(0, SOURCE_MAX))}`,
    ...(firstNonEmpty(strategy) === undefined ? [] : [`strategy: ${strategy}`]),
    ...(approval === undefined ? [] : [`approval: ${approval}`]),
    ...(mode === undefined ? [] : [`mode: ${mode}`]),
  ];

  return injectFrontmatter(head, slug, body);
}

/** The saved frontmatter an update keeps for each key it does not send; a full frontmatter drops them. */
function keptKeys(pre: Preamble, prev: FrontmatterMap): Pick<RenderInput, "reviews" | "strategy" | "approval"> {
  function keep(sent: string | undefined, saved: string | undefined) {
    return sent ?? (pre.fullFrontmatter ? undefined : saved);
  }

  return {
    approval: keep(pre.approval, prev.approval),
    reviews: keep(pre.reviews, prev.reviews),
    strategy: keep(pre.strategy, prev.strategy),
  };
}

function serialOf(filename: string): number {
  return parseInt(String(filename.split("-")[0]), DECIMAL);
}

/** The file an update saves: the sent body under the saved file's name, serial and kept keys. */
function updatedFile(filename: string, content: string, previous: string): string {
  const pre = preamble(content);
  const prev = splitFrontmatter(previous).map;
  const slug = slugFromFilename(filename);

  return render({
    ...keptKeys(pre, prev),
    body: pre.body,
    created: createdAtOf(prev.created),
    mode: pre.mode,
    serial: serialOf(filename),
    slug,
    source: persistSource([prev.source, pre.name], pre.body.match(GOAL_SECTION_RE), slug),
    status: firstNonEmpty(pre.status, prev.status) ?? DRAFT_STATUS,
  });
}

/**
 * Rewrite of a saved roadmap: same file and serial, saved frontmatter kept unless sent.
 * Validates only. The host writes `content`: a write here first makes Claude Code refuse the
 * Write as modified since read.
 */
export function prepareRoadmapUpdate(input: Rewrite): RoadmapResult {
  const { raw, previous, filename, rel } = rewriteTarget(input);
  const fence = unclosedFenceErrors(raw);

  if (fence.length > 0) return refused(fence);
  const full = updatedFile(filename, raw, previous);
  const errors = validateRoadmap(filename, full, { fresh: false, previous });

  if (errors.length > 0) return refused(errors);

  return { content: full, filename, ok: true, path: rel, serial: serialOf(filename) };
}

/** What a new roadmap is saved from beyond its text: when, and the strategy it gets without a `strategy:` line. */
type NewInput = { created: string | undefined; defaultStrategy: Strategy };

/** A new roadmap's next serial, file name and text. */
function newFile(dir: string, pre: Preamble, { created, defaultStrategy }: NewInput) {
  const slug = slugify(pre.name);
  const createdAt = createdAtOf(created);
  const serial = nextSerial(dir, "");
  const filename = `${serial}-${slug}-${compactCreatedStamp(createdAt)}.md`;

  const full = render({
    approval: pre.approval,
    body: pre.body,
    created: createdAt,
    mode: pre.mode,
    reviews: 0,
    serial,
    slug,
    source: persistSource([pre.name], pre.body.match(GOAL_SECTION_RE), slug),
    status: firstNonEmpty(pre.status) ?? DRAFT_STATUS,
    strategy: pre.strategy ?? defaultStrategy,
  });

  return { filename, full, serial };
}

/** What a new roadmap save takes; `defaultStrategy` is `free` when not given. */
type SaveInput = { workspaceRoot?: string; content?: string; created?: string; defaultStrategy?: Strategy };

export function persistRoadmap({
  workspaceRoot,
  content,
  created,
  defaultStrategy = AGENT_DEFAULTS.defaultStrategy,
}: SaveInput = {}): RoadmapResult {
  const { ws, raw } = saveTarget(workspaceRoot, content);
  const dir = path.join(ws, ROADMAP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const fence = unclosedFenceErrors(raw);

  if (fence.length > 0) return refused(fence);
  const { serial, filename, full } = newFile(dir, preamble(raw), { created, defaultStrategy });
  const errors = validateRoadmap(filename, full, { fresh: true });

  if (errors.length > 0) return refused(errors);
  fs.writeFileSync(path.join(dir, filename), full);

  return { content: full, filename, ok: true, path: `${ROADMAP_DIR}/${filename}`, serial };
}
