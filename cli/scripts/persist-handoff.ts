#!/usr/bin/env bun
/** Allocate/slugify/validate/write a session handoff under .tmp/repo/handoffs/. */
import fs from "node:fs";
import path from "node:path";

import { firstNonEmpty } from "./first-non-empty.ts";
import {
  type PersistResult,
  createdLine,
  extractH1,
  injectFrontmatter as injectDoc,
  nextSerial,
  slugify,
  sourceLine,
  stripFrontmatter,
} from "./persist-doc.ts";
import { validateHandoff } from "./persist-handoff-validate.ts";
import { GOAL_SECTION_RE, HANDOFF_DIR, NAME_LINE_RE, NAME_STRIP_RE } from "./persist-handoff.constants.ts";
import { persistSource, refused, saveTarget, stampedName } from "./persist-save.ts";
import { unclosedFenceErrors } from "./persist-sections.ts";

export function extractHandoffName(content: unknown): string {
  const m = String(content).match(NAME_LINE_RE);
  return m === null ? "" : String(m[1]).trim();
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
  source?: string;
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

type SaveInput = {
  workspaceRoot?: string;
  content?: string;
  source?: string;
  created?: string;
};

export function persistHandoff({ workspaceRoot, content, source, created }: SaveInput = {}): HandoffResult {
  const { ws, raw } = saveTarget(workspaceRoot, content);
  const fence = unclosedFenceErrors(raw);
  if (fence.length > 0) return refused(fence);
  const body = stripHandoffName(raw);
  const name = firstNonEmpty(extractHandoffName(raw)) ?? extractH1(stripFrontmatter(body));
  const slug = slugify(name);
  const dir = path.join(ws, HANDOFF_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const { createdAt, free } = stampedName(dir, { created, first: nextSerial(dir), slug });
  if (free === undefined) return { error: "serial collision", ok: false };
  const { serial, filename, dest } = free;
  const full = injectFrontmatter({
    body,
    created: createdAt,
    serial,
    slug,
    source: persistSource([source, name], stripFrontmatter(body).match(GOAL_SECTION_RE), slug),
  });
  const errors = validateHandoff(filename, full);
  if (errors.length > 0) return refused(errors);
  fs.writeFileSync(dest, full);
  return { content: full, filename, ok: true, path: `${HANDOFF_DIR}/${filename}`, serial, slug };
}
