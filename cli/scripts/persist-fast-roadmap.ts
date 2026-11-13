#!/usr/bin/env bun
/** Allocate/slugify/validate/write a fast roadmap under .repo/roadmaps-fast/. */
import { validateFastRoadmap } from "./persist-fast-roadmap-validate.ts";
import { FAST_ORDER_RE, FAST_ROADMAP_DIR, FAST_ROADMAP_NAME_RE } from "./persist-fast-roadmap.constants.ts";
import { type FastKind, type FastSaveInput, saveFast } from "./persist-fast-save.ts";
import { type PlanResult, type Rewrite, prepareRewrite } from "./persist-save.ts";

const FAST_ROADMAP: FastKind = {
  commit: false,
  dir: FAST_ROADMAP_DIR,
  nameRe: FAST_ROADMAP_NAME_RE,
  sourceRe: FAST_ORDER_RE,
  status: "draft",
  validate: validateFastRoadmap,
};

/** Rewrite of a saved fast roadmap: `[x]`, Locations and status moves allowed. */
export function prepareFastRoadmapUpdate(input: Rewrite): PlanResult {
  return prepareRewrite(input, (filename, full) => validateFastRoadmap(filename, full, { fresh: false }));
}

/** Saves a new fast roadmap: serial counted in `roadmaps-fast` only, frontmatter without reviews or strategy. */
export function persistFastRoadmap(input: FastSaveInput): PlanResult {
  return saveFast(input, FAST_ROADMAP);
}
