/** Under /away a Stop runs a settled approval block's header choice, a bare `i`, and logs it in each file. */
import fs from "node:fs";

import { z } from "zod";

import { tryJson } from "../json.ts";
import type { Result } from "../result.ts";
import { errorMessage } from "../sync-errors.ts";
import { parseClosingBlock } from "./closing-line.ts";
import type { HookInput } from "./hook-input.ts";
import { approvableItems, approvedText } from "./orchestrate-approvals.ts";
import { itemKey, itemStrategy } from "./orchestrate-reviews.ts";
import { resolveStamp, stampMtime, writeStamp } from "./orchestrate-stamps.ts";
import { APPROVAL_BLOCK_STAMP, AWAY_RUN_REASON, AWAY_RUN_STAMP, TURN_START_STAMP } from "./orchestrate.constants.ts";
import type { ApprovalItem, ItemKind } from "./orchestrate.types.ts";
import type { PersistResult } from "./persist-doc.ts";
import { prepareFastPlanUpdate } from "./persist-fast-plan.ts";
import { prepareFastRoadmapUpdate } from "./persist-fast-roadmap.ts";
import { withEntry } from "./persist-mistakes.ts";
import { preparePlanUpdate } from "./persist-plan.ts";
import { prepareRoadmapUpdate } from "./persist-roadmap.ts";
import type { Rewrite } from "./persist-save.ts";
import { resolveRoots } from "./workspace-root.ts";

const AWAY_RUN_WHY = "away runs the block's header choice once the review settled";

/** What each run left: the item's key and its file's mtime after the write. */
type AwayRuns = Record<string, number>;

/** Each kind's rewrite through its persist module, so a new kind fails to compile until it has one. */
const PREPARE: Readonly<Record<ItemKind, (input: Rewrite) => PersistResult<{ content: string }>>> = {
  "fast-plan": prepareFastPlanUpdate,
  "fast-roadmap": prepareFastRoadmapUpdate,
  plan: preparePlanUpdate,
  roadmap: prepareRoadmapUpdate,
};

function awayRunsSchema() {
  return z.record(z.string(), z.number());
}

/** The runs this session's stamp holds; empty when there is none or it does not parse. */
function readRuns(data: HookInput): AwayRuns {
  const p = resolveStamp(data, AWAY_RUN_STAMP);

  return p === null ? {} : (tryJson(awayRunsSchema(), fs.readFileSync(p, "utf8")) ?? {});
}

/** Approvable items the reply's block names or this turn saved, minus those already run at their current mtime. */
function dueItems(data: HookInput, msg: string, runs: AwayRuns): ApprovalItem[] {
  const named = new Set((parseClosingBlock(msg) ?? []).map(itemKey));
  const turnStart = stampMtime(data, TURN_START_STAMP);

  function due(i: ApprovalItem): boolean {
    return named.has(itemKey(i)) || (turnStart !== null && i.mtime >= turnStart);
  }

  return approvableItems(data).filter((i) => due(i) && runs[itemKey(i)] !== i.mtime);
}

function decisionLine(i: ApprovalItem): string {
  const strategy = itemStrategy(i);
  const choice = strategy === null ? "i" : `i (strategy ${strategy})`;

  return `- decision: approval of ${itemKey(i)} under /away → ${choice}, because ${AWAY_RUN_WHY}`;
}

/** Logs the run in the item's file through its kind's persist module: the file's new mtime, or why it was refused. */
function logRun(ws: string, i: ApprovalItem): Result<number, string> {
  try {
    const content = withEntry(fs.readFileSync(i.path, "utf8"), decisionLine(i));
    const result = PREPARE[i.kind]({ content, filePath: i.path, workspaceRoot: ws });

    if (!result.ok) return { error: result.error, ok: false };
    fs.writeFileSync(i.path, result.content);

    return { ok: true, value: fs.statSync(i.path).mtimeMs };
  } catch (e) {
    return { error: errorMessage(e), ok: false };
  }
}

/** One sentence for an item the run refused, so the reply still ends with its block. */
function refusedText(i: ApprovalItem, error: string): string {
  return `; ${itemKey(i)} was not run (${error}) so end with the approval block for it`;
}

// The Stop reason when an /away Stop ran settled items' header choice; null when none was due or each was refused.
// An item refused next to one that ran is named, and the approval block stays asked for so the next Stop asks for it.
export function orchestrateAway(data: HookInput, msg: string): string | null {
  const ws = resolveRoots(data).root;
  const runs = readRuns(data);
  const ran: ApprovalItem[] = [];
  const refused: string[] = [];

  for (const i of dueItems(data, msg, runs)) {
    const run = logRun(ws, i);

    if (!run.ok) {
      refused.push(refusedText(i, run.error));
      continue;
    }

    runs[itemKey(i)] = run.value;
    ran.push(i);
  }

  if (ran.length === 0) return null;
  writeStamp(data, AWAY_RUN_STAMP, JSON.stringify(runs));

  if (refused.length === 0) writeStamp(data, APPROVAL_BLOCK_STAMP, "1");

  return `${AWAY_RUN_REASON}; ${approvedText(ran)}${refused.join("")}`;
}
