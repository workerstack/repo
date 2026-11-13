#!/usr/bin/env bun
/** Allocate/slugify/validate/write a fast plan under .repo/plans-fast/. */
import fs from "node:fs";
import path from "node:path";

import { firstNonEmpty } from "./first-non-empty.ts";
import { createdLine, extractH1, injectFrontmatter, slugify, sourceLine, stripFrontmatter } from "./persist-doc.ts";
import { validateFastPlan } from "./persist-fast-plan-validate.ts";
import { FAST_GOAL_RE, FAST_PLAN_DIR, FAST_PLAN_NAME_RE } from "./persist-fast-plan.constants.ts";
import { extractCommit, stripCommitLine } from "./persist-plan-head.ts";
import {
  type PlanResult,
  type Rewrite,
  allocate,
  persistSource,
  prepareRewrite,
  refused,
  saveTarget,
} from "./persist-save.ts";
import { unclosedFenceErrors } from "./persist-sections.ts";

type SaveInput = { workspaceRoot?: string; content?: string; source?: string; created?: string };

/** The `FAST_PLAN_NAME:` line above the first `## `, and the text without it and the blanks after it. */
function splitName(raw: string) {
  const lines = raw.split("\n");
  const end = lines.findIndex((l) => l.startsWith("## "));
  const at = lines.slice(0, end < 0 ? lines.length : end).findIndex((l) => FAST_PLAN_NAME_RE.test(l));

  if (at < 0) return { name: "", rest: raw };
  const name = String(FAST_PLAN_NAME_RE.exec(String(lines[at]))?.[1]);
  const after = lines.slice(at + 1);
  const blanks = after.findIndex((l) => l.trim() !== "");

  return { name, rest: [...lines.slice(0, at), ...after.slice(blanks < 0 ? after.length : blanks)].join("\n") };
}

/** Rewrite of a saved fast plan: `[x]` and status moves allowed. */
export function prepareFastPlanUpdate(input: Rewrite): PlanResult {
  return prepareRewrite(input, (filename, full) => validateFastPlan(filename, full, { fresh: false }));
}

/** Saves a new fast plan: serial counted in `plans-fast` only, frontmatter without reviews or strategy. */
export function persistFastPlan(input: SaveInput): PlanResult {
  const { ws, raw } = saveTarget(input.workspaceRoot, input.content);
  const fence = unclosedFenceErrors(raw);

  if (fence.length > 0) return refused(fence);
  const { name, rest } = splitName(raw);
  const body = stripCommitLine(rest);
  const planName = firstNonEmpty(name) ?? extractH1(stripFrontmatter(body));
  const slug = slugify(planName);
  const { createdAt, serial, filename, dest } = allocate(path.join(ws, FAST_PLAN_DIR), slug, input.created);
  const commit = extractCommit(raw);

  const lines = [
    `serial: ${serial}`,
    `name: ${slug}`,
    "status: ready",
    createdLine(createdAt),
    sourceLine(persistSource([input.source, name], FAST_GOAL_RE.exec(stripFrontmatter(body)), slug)),
    ...(commit === undefined ? [] : [`commit: ${commit}`]),
  ];

  const full = injectFrontmatter(lines, slug, stripFrontmatter(body));
  const errors = validateFastPlan(filename, full);

  if (errors.length > 0) return refused(errors);
  // `wx`: a name taken since the serial was read fails loudly instead of overwriting another plan.
  fs.writeFileSync(dest, full, { flag: "wx" });

  return { content: full, filename, ok: true, path: `${FAST_PLAN_DIR}/${filename}`, serial, slug };
}
