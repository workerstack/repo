#!/usr/bin/env bun
/** Allocate/slugify/validate/write a fast plan under .repo/plans-fast/. */
import { validateFastPlan } from "./persist-fast-plan-validate.ts";
import { FAST_GOAL_RE, FAST_PLAN_DIR, FAST_PLAN_NAME_RE } from "./persist-fast-plan.constants.ts";
import { type FastKind, type FastSaveInput, saveFast } from "./persist-fast-save.ts";
import { type PlanResult, type Rewrite, prepareRewrite } from "./persist-save.ts";

const FAST_PLAN: FastKind = {
  commit: true,
  dir: FAST_PLAN_DIR,
  nameRe: FAST_PLAN_NAME_RE,
  sourceRe: FAST_GOAL_RE,
  status: "ready",
  validate: validateFastPlan,
};

/** Rewrite of a saved fast plan: `[x]`, status moves and Previous mistakes appends allowed. */
export function prepareFastPlanUpdate(input: Rewrite): PlanResult {
  return prepareRewrite(input, (filename, full, previous) =>
    validateFastPlan(filename, full, { fresh: false, previous }),
  );
}

/** Saves a new fast plan: serial counted in `plans-fast` only, frontmatter without reviews or strategy. */
export function persistFastPlan(input: FastSaveInput): PlanResult {
  return saveFast(input, FAST_PLAN);
}
