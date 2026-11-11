#!/usr/bin/env bun
/** Allocate/slugify/validate/write a session journal under .tmp/repo/implementations/. */
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
import { validateImplementation } from "./persist-implementation-validate.ts";
import {
  DONE_SECTION_RE,
  FULL_BODY_RES,
  IMPLEMENTATION_DIR,
  META_LINE_RE,
  NAME_RE,
  NO_PLAN,
  PLAN_NUMBER_RE,
  PLAN_RE,
  PLAN_VALUE_RE,
} from "./persist-implementation.constants.ts";
import { unclosedFenceErrors } from "./persist-sections.ts";
import { resolveRoots } from "./workspace-root.ts";

export function extractImplName(content: unknown): string {
  const m = String(content).match(NAME_RE);
  return m ? String(m[1]).trim() : "";
}

export function extractImplPlan(content: unknown): string {
  const m = String(content).match(PLAN_RE);
  if (!m) return NO_PLAN;
  const v = String(m[1]).trim().toLowerCase();
  if (v === NO_PLAN || v === "") return NO_PLAN;
  return PLAN_NUMBER_RE.test(v) ? v : "";
}

export function stripImplMeta(content: unknown): string {
  return String(content)
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => !META_LINE_RE.test(line))
    .join("\n");
}

export function isFullImplementationBody(content: unknown): boolean {
  const s = String(content || "");
  return FULL_BODY_RES.some((re) => re.test(s));
}

export function injectFrontmatter({
  serial,
  slug,
  source,
  body,
  created,
  plan,
}: {
  serial: number;
  slug: string;
  source?: unknown;
  body: string;
  created?: string;
  plan?: string;
}): string {
  const planVal = PLAN_VALUE_RE.test(String(plan || "")) ? String(plan) : NO_PLAN;
  const lines = [
    `serial: ${serial}`,
    `plan: ${planVal}`,
    `name: ${slug}`,
    "status: in-progress",
    createdLine(created),
    sourceLine(source),
  ];
  return injectDoc(lines, slug, stripFrontmatter(body));
}

export type ImplementationResult = PersistResult<{
  path: string;
  serial: number;
  slug: string;
  content: string;
  filename: string;
  plan: string;
}>;

/** The `source:` text: what the caller sent, else the name, else the Done section squeezed to one line, else the slug. */
function sourceOf(
  body: string,
  { source, name, slug }: { source?: string | undefined; name: string; slug: string },
): string {
  const done = stripFrontmatter(body).match(DONE_SECTION_RE);
  return String(source || name || (done ? String(done[1]).trim().replace(/\s+/g, " ") : slug)).slice(0, SOURCE_MAX);
}

interface SaveInput {
  workspaceRoot?: string;
  content?: unknown;
  source?: string;
  created?: string;
}

export function persistImplementation({
  workspaceRoot,
  content,
  source,
  created,
}: SaveInput = {}): ImplementationResult {
  const ws = workspaceRoot || resolveRoots().root;
  const raw = String(content || "");
  const fence = unclosedFenceErrors(raw);
  if (fence.length) return { error: fence.join("; "), errors: fence, ok: false };
  const name = extractImplName(raw) || extractH1(stripFrontmatter(stripImplMeta(raw)));
  const slug = slugify(name);
  const dir = path.join(ws, IMPLEMENTATION_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const plan = extractImplPlan(raw);
  if (raw.match(PLAN_RE) && !plan) return { error: "plan", errors: ["plan"], ok: false };
  const body = stripImplMeta(raw);
  const createdAt = createdAtOf(created);
  const free = freeName(dir, { first: nextSerial(dir), slug, stamp: compactCreatedStamp(createdAt) });
  if (!free) return { error: "serial collision", ok: false };
  const { serial, filename, dest } = free;
  const sourceText = sourceOf(body, { name, slug, source });
  const full = injectFrontmatter({ body, created: createdAt, plan, serial, slug, source: sourceText });
  const errors = validateImplementation(filename, full);
  if (errors.length) return { error: errors.join("; "), errors, ok: false };
  fs.writeFileSync(dest, full);
  return { content: full, filename, ok: true, path: `${IMPLEMENTATION_DIR}/${filename}`, plan, serial, slug };
}
