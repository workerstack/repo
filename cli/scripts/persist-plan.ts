#!/usr/bin/env bun
/** Allocate/slugify/validate/write a local plan under .tmp/repo/plans/. */
import fs from "node:fs";
import path from "node:path";

import { matchLessons, type Roots } from "./lessons.ts";
import { DATETIME_RE, FM_OPEN, SERIAL_PREFIX_RE, SOURCE_MAX } from "./persist-doc.constants.ts";
import {
  captured,
  compactCreatedStamp,
  extractH1,
  nextSerial,
  slugFromFilename,
  slugify,
  stripFrontmatter,
  utcDateTime,
  type PersistResult,
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
import { sectionBodies, unclosedFenceErrors } from "./persist-sections.ts";
import { resolveRoots } from "./workspace-root.ts";

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
  content?: unknown;
  source?: string;
  created?: string;
};

const refuse = (errors: string[]): PlanResult => ({ error: errors.join("; "), errors, ok: false });

/** Lessons matching files a new plan names, held by the checkout of each file, that Watch-outs does not cite. */
function uncitedLessons(roots: Roots, text: string) {
  const files = [...new Set([roots.root, roots.checkout].flatMap((top) => workspacePaths(top, text)))];
  if (!files.length) return [];
  const watch = sectionBodies(stripFrontmatter(text)).bodies[WATCH_OUTS_H2] || "";
  return matchLessons({ files, roots }).filter((r) => !watch.includes(r.file));
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
  if (fence.length) return refuse(fence);
  const full = text.startsWith(FM_OPEN) ? text : withSavedFrontmatter(previous, text);
  const errors = validatePlan(filename, full, { fresh: false, previous });
  if (errors.length) return refuse(errors);
  return {
    content: full,
    filename,
    ok: true,
    path: path.relative(ws, abs).split(path.sep).join("/"),
    serial: Number(SERIAL_PREFIX_RE.exec(filename)?.[1]), // validatePlan accepted the filename, so the serial prefix is there
    slug: slugFromFilename(filename),
  };
}

/** The `source:` line: what the caller sent, else the plan name, else the Goal squeezed to one line, else the slug. */
function sourceOf({ source, planName, body, slug }: { source?: string; planName: string; body: string; slug: string }) {
  const goal = GOAL_SECTION_RE.exec(stripFrontmatter(body));
  const fromGoal = goal ? captured(goal, 1).trim().replaceAll(/\s+/g, " ") : slug;
  return String(source || planName || fromGoal).slice(0, SOURCE_MAX);
}

/** Next serial and the file a new plan is written to. */
function allocate(plansDir: string, slug: string, created: string | undefined) {
  fs.mkdirSync(plansDir, { recursive: true });
  const createdAt = created && DATETIME_RE.test(created) ? created : utcDateTime();
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
    source: sourceOf({ ...(source === undefined ? {} : { source }), body, planName, slug }),
    strategy: extractStrategy(raw),
  });
}

export function persistPlan(input: SaveInput = {}): PlanResult {
  const ws = input.workspaceRoot || resolveRoots().root;
  // Lesson citations read tracked lessons, which live in the checkout that holds each file the plan names.
  const lessonRoots = { checkout: input.checkout || ws, cwd: ws, root: ws };
  const raw = String(input.content || "");
  // Line numbers in this deny count from what the caller sent.
  const fence = unclosedFenceErrors(raw);
  if (fence.length) return refuse(fence);
  const planName = extractPlanName(raw) || extractH1(stripFrontmatter(stripPlanName(raw)));
  const slug = slugify(planName);
  const { createdAt, serial, filename, dest } = allocate(path.join(ws, PLAN_DIR), slug, input.created);
  if (fs.existsSync(dest)) return { error: "serial collision", ok: false };
  const full = draftPlan(raw, input.source, { createdAt, planName, serial, slug });
  const errors = validatePlan(filename, full);
  for (const r of uncitedLessons(lessonRoots, full))
    errors.push(`cite this matched lesson in Watch-outs: ${r.file} (${r.summary})`);

  if (errors.length) return refuse(errors);
  fs.writeFileSync(dest, full);
  return { content: full, filename, ok: true, path: `${PLAN_DIR}/${filename}`, serial, slug };
}
