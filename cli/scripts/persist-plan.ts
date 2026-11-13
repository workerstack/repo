#!/usr/bin/env bun
/** Allocate/slugify/validate/write a local plan under .repo/plans/. */
import fs from "node:fs";
import path from "node:path";

import { firstNonEmpty } from "./first-non-empty.ts";
import { matchLessons } from "./lessons-ops.ts";
import { type Roots } from "./lessons.types.ts";
import { FM_OPEN, SERIAL_PREFIX_RE } from "./persist-doc.constants.ts";
import {
  compactCreatedStamp,
  createdAtOf,
  extractH1,
  nextSerial,
  slugFromFilename,
  slugify,
  stripFrontmatter,
  type PersistResult,
  stripBom,
} from "./persist-doc.ts";
import { extractMode, extractStrategy, stripModeLine, stripStrategyLine } from "./persist-keys.ts";
import {
  extractCommit,
  extractPlanName,
  injectFrontmatter,
  stripCommitLine,
  stripPlanName,
  withSavedFrontmatter,
} from "./persist-plan-head.ts";
import { validatePlan, workspacePaths } from "./persist-plan-validate.ts";
import { GOAL_SECTION_RE, PLAN_DIR, WATCH_OUTS_H2 } from "./persist-plan.constants.ts";
import { type Rewrite, persistSource, refused, rewriteTarget, saveTarget } from "./persist-save.ts";
import { sectionBodies, unclosedFenceErrors } from "./persist-sections.ts";

export type PlanResult = PersistResult<{
  path: string;
  serial: number;
  slug: string;
  content: string;
  filename: string;
}>;

type SaveInput = {
  workspaceRoot?: string;
  checkout?: string;
  content?: string;
  source?: string;
  created?: string;
};

/** Lessons matching files a new plan names, held by the checkout of each file, that Watch-outs does not cite. */
function uncitedLessons(roots: Roots, text: string) {
  const files = [...new Set([roots.root, roots.checkout].flatMap((top) => workspacePaths(top, text)))];

  if (files.length === 0) return [];
  const watch = sectionBodies(stripFrontmatter(text)).bodies[WATCH_OUTS_H2] ?? "";

  return matchLessons({ files, roots }).filter((r) => !watch.includes(r.file));
}

/**
 * Rewrite of a saved plan: same file and serial, `[x]` allowed, Previous mistakes append-only.
 * Validates only. The host writes `content`: a write here first makes Claude Code refuse the
 * Write as modified since read.
 */
export function preparePlanUpdate(input: Rewrite): PlanResult {
  const { raw, previous, filename, rel } = rewriteTarget(input);
  const text = stripBom(raw);
  const fence = unclosedFenceErrors(text);

  if (fence.length > 0) return refused(fence);
  const full = text.startsWith(FM_OPEN) ? text : withSavedFrontmatter(previous, text);
  const errors = validatePlan(filename, full, { fresh: false, previous });

  if (errors.length > 0) return refused(errors);

  return {
    content: full,
    filename,
    ok: true,
    path: rel,
    // validatePlan accepted the filename, so the serial prefix is there
    serial: Number(SERIAL_PREFIX_RE.exec(filename)?.[1]),
    slug: slugFromFilename(filename),
  };
}

/** Next serial and the file a new plan is written to. */
function allocate(plansDir: string, slug: string, created: string | undefined) {
  fs.mkdirSync(plansDir, { recursive: true });
  const createdAt = createdAtOf(created);
  const serial = nextSerial(plansDir);
  const filename = `${serial}-${slug}-${compactCreatedStamp(createdAt)}.md`;

  return { createdAt, dest: path.join(plansDir, filename), filename, serial };
}

type Parts = {
  serial: number;
  slug: string;
  createdAt: string;
  planName: string;
};

/** The plan text a save writes: frontmatter on the body, with the keys read from what the caller sent. */
function draftPlan(raw: string, source: string | undefined, { serial, slug, createdAt, planName }: Parts) {
  const body = stripModeLine(stripStrategyLine(stripCommitLine(stripPlanName(raw))));

  return injectFrontmatter({
    body,
    commit: extractCommit(raw),
    created: createdAt,
    mode: extractMode(raw),
    serial,
    slug,
    // The `source:` line: what the caller sent, else the plan name, else the Goal squeezed to one line, else the slug.
    source: persistSource([source, planName], GOAL_SECTION_RE.exec(stripFrontmatter(body)), slug),
    strategy: extractStrategy(raw),
  });
}

export function persistPlan(input: SaveInput = {}): PlanResult {
  const { ws, raw } = saveTarget(input.workspaceRoot, input.content);
  // Lesson citations read tracked lessons, which live in the checkout that holds each file the plan names.
  const lessonRoots = { checkout: firstNonEmpty(input.checkout) ?? ws, cwd: ws, root: ws };
  // Line numbers in this deny count from what the caller sent.
  const fence = unclosedFenceErrors(raw);

  if (fence.length > 0) return refused(fence);
  const planName = firstNonEmpty(extractPlanName(raw)) ?? extractH1(stripFrontmatter(stripPlanName(raw)));
  const slug = slugify(planName);
  const { createdAt, serial, filename, dest } = allocate(path.join(ws, PLAN_DIR), slug, input.created);

  if (fs.existsSync(dest)) return { error: "serial collision", ok: false };
  const full = draftPlan(raw, input.source, { createdAt, planName, serial, slug });
  const errors = validatePlan(filename, full);

  for (const r of uncitedLessons(lessonRoots, full))
    errors.push(`cite this matched lesson in Watch-outs: ${r.file} (${r.summary})`);

  if (errors.length > 0) return refused(errors);
  fs.writeFileSync(dest, full);

  return { content: full, filename, ok: true, path: `${PLAN_DIR}/${filename}`, serial, slug };
}
