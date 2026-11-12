#!/usr/bin/env bun
/** Allocate/slugify/validate/write a session journal under .tmp/repo/implementations/. */
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
  stripBom,
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
import { persistSource, refused, saveTarget, stampedName } from "./persist-save.ts";
import { unclosedFenceErrors } from "./persist-sections.ts";

const LINE_BREAK_RE = /\r?\n/;

export function extractImplName(content: string): string {
  const m = content.match(NAME_RE);

  return m === null ? "" : String(m[1]).trim();
}

export function extractImplPlan(content: string): string {
  const m = content.match(PLAN_RE);

  if (m === null) return NO_PLAN;
  const v = String(m[1]).trim().toLowerCase();

  if (v === NO_PLAN || v === "") return NO_PLAN;

  return PLAN_NUMBER_RE.test(v) ? v : "";
}

export function stripImplMeta(content: string): string {
  return stripBom(content)
    .split(LINE_BREAK_RE)
    .filter((line) => !META_LINE_RE.test(line))
    .join("\n");
}

export function isFullImplementationBody(content: string): boolean {
  return FULL_BODY_RES.some((re) => re.test(content));
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
  source?: string;
  body: string;
  created?: string;
  plan?: string;
}): string {
  const planVal = PLAN_VALUE_RE.test(plan ?? "") ? String(plan) : NO_PLAN;

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

type SaveInput = {
  workspaceRoot?: string;
  content?: string;
  source?: string;
  created?: string;
};

export function persistImplementation({
  workspaceRoot,
  content,
  source,
  created,
}: SaveInput = {}): ImplementationResult {
  const { ws, raw } = saveTarget(workspaceRoot, content);
  const fence = unclosedFenceErrors(raw);

  if (fence.length > 0) return refused(fence);
  const name = firstNonEmpty(extractImplName(raw)) ?? extractH1(stripFrontmatter(stripImplMeta(raw)));
  const slug = slugify(name);
  const dir = path.join(ws, IMPLEMENTATION_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const plan = extractImplPlan(raw);

  if (PLAN_RE.test(raw) && plan === "") return { error: "plan", errors: ["plan"], ok: false };
  const body = stripImplMeta(raw);
  const { createdAt, free } = stampedName(dir, { created, first: nextSerial(dir), slug });

  if (free === undefined) return { error: "serial collision", ok: false };
  const { serial, filename, dest } = free;
  const sourceText = persistSource([source, name], stripFrontmatter(body).match(DONE_SECTION_RE), slug);
  const full = injectFrontmatter({ body, created: createdAt, plan, serial, slug, source: sourceText });
  const errors = validateImplementation(filename, full);

  if (errors.length > 0) return refused(errors);
  fs.writeFileSync(dest, full);

  return { content: full, filename, ok: true, path: `${IMPLEMENTATION_DIR}/${filename}`, plan, serial, slug };
}
