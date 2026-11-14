/** Each item kind's rewrite through its persist module, so a new kind fails to compile until it has one. */
import type { ItemKind } from "./orchestrate.types.ts";
import type { PersistResult } from "./persist-doc.ts";
import { prepareFastPlanUpdate } from "./persist-fast-plan.ts";
import { prepareFastRoadmapUpdate } from "./persist-fast-roadmap.ts";
import { preparePlanUpdate } from "./persist-plan.ts";
import { prepareRoadmapUpdate } from "./persist-roadmap.ts";
import type { Rewrite } from "./persist-save.ts";

const PREPARE: Readonly<Record<ItemKind, (input: Rewrite) => PersistResult<{ content: string }>>> = {
  "fast-plan": prepareFastPlanUpdate,
  "fast-roadmap": prepareFastRoadmapUpdate,
  plan: preparePlanUpdate,
  roadmap: prepareRoadmapUpdate,
};

/** The validated rewrite of an item's file through the persist module of its kind. */
export function prepareItemUpdate(kind: ItemKind, input: Rewrite): PersistResult<{ content: string }> {
  return PREPARE[kind](input);
}
