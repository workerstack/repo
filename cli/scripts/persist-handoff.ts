#!/usr/bin/env bun
/** Allocate/slugify/validate/write a session handoff under .tmp/repo/handoffs/. */
import fs from "node:fs";
import path from "node:path";

import { SOURCE_MAX } from "./persist-doc.constants.ts";
import {
  type PersistResult,
  compactCreatedStamp,
  createdAtOf,
  createdLine,
  extractH1,
  freeName,
  injectFrontmatter as injectDoc,
  nextSerial,
  slugify,
  sourceLine,
  stripFrontmatter,
} from "./persist-doc.ts";
import { validateHandoff } from "./persist-handoff-validate.ts";
import { GOAL_SECTION_RE, HANDOFF_DIR, NAME_LINE_RE, NAME_STRIP_RE } from "./persist-handoff.constants.ts";
import { unclosedFenceErrors } from "./persist-sections.ts";
import { resolveRoots } from "./workspace-root.ts";

export function extractHandoffName(content: unknown): string {
  const m = String(content).match(NAME_LINE_RE);
  return m ? String(m[1]).trim() : "";
}

export function stripHandoffName(content: unknown): string {
  return String(content).replace(NAME_STRIP_RE, "");
}

export function injectFrontmatter({
  serial,
  slug,
  source,
  body,
  created,
}: {
  serial: number;
  slug: string;
  source?: unknown;
  body: string;
  created?: string;
}): string {
  const lines = [`serial: ${serial}`, `name: ${slug}`, "status: open", createdLine(created), sourceLine(source)];
  return injectDoc(lines, slug, stripFrontmatter(body));
}

export type HandoffResult = PersistResult<{
  path: string;
  serial: number;
  slug: string;
  content: string;
  filename: string;
}>;

/** The `source:` text: what the caller sent, else the name, else the Goal squeezed to one line, else the slug. */
function sourceOf(
  body: string,
  { source, name, slug }: { source?: string | undefined; name: string; slug: string },
): string {
  const goal = stripFrontmatter(body).match(GOAL_SECTION_RE);
  return String(source || name || (goal ? String(goal[1]).trim().replace(/\s+/g, " ") : slug)).slice(0, SOURCE_MAX);
}

interface SaveInput {
  workspaceRoot?: string;
  content?: unknown;
  source?: string;
  created?: string;
}

export function persistHandoff({ workspaceRoot, content, source, created }: SaveInput = {}): HandoffResult {
  const ws = workspaceRoot || resolveRoots().root;
  const raw = String(content || "");
  const fence = unclosedFenceErrors(raw);
  if (fence.length) return { error: fence.join("; "), errors: fence, ok: false };
  const body = stripHandoffName(raw);
  const name = extractHandoffName(raw) || extractH1(stripFrontmatter(body));
  const slug = slugify(name);
  const dir = path.join(ws, HANDOFF_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const createdAt = createdAtOf(created);
  const free = freeName(dir, { first: nextSerial(dir), slug, stamp: compactCreatedStamp(createdAt) });
  if (!free) return { error: "serial collision", ok: false };
  const { serial, filename, dest } = free;
  const full = injectFrontmatter({
    body,
    created: createdAt,
    serial,
    slug,
    source: sourceOf(body, { name, slug, source }),
  });
  const errors = validateHandoff(filename, full);
  if (errors.length) return { error: errors.join("; "), errors, ok: false };
  fs.writeFileSync(dest, full);
  return { content: full, filename, ok: true, path: `${HANDOFF_DIR}/${filename}`, serial, slug };
}
