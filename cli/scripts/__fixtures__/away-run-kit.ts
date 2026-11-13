// What the away run suites share: a Claude session under a session mode, the fast bodies, and the run's texts.
import path from "node:path";

import { claudeSession } from "./fast-session.ts";
import type { HookSession } from "./hook-session.ts";
import type { OrchestrateKit } from "./orchestrate-kit.ts";
import { AWAY_RUN_REASON, AWAY_RUN_STAMP, ORCHESTRATOR_LOGS_DIR } from "../orchestrate.constants.ts";

const WHY = "away runs the block's header choice once the review settled";

export const FAST_PLAN_BODY = [
  "FAST_PLAN_NAME: add tmp ignore",
  "commit: chore: ignore .tmp",
  "# add-tmp-ignore",
  "",
  "## Goal",
  "Ignore `.tmp/` in git.",
  "",
  "## Steps",
  "1 [ ] add `.tmp/` to `.gitignore`",
  "",
  "## Verify",
  "2 [ ] `git check-ignore .tmp/x` prints it",
  "",
].join("\n");

export const FAST_ROADMAP_BODY = [
  "FAST_ROADMAP_NAME: tidy ignores",
  "# tidy-ignores",
  "",
  "## Order",
  "1 [ ] ignore tmp: add .tmp/ to .gitignore",
  "2 [ ] ignore logs: add *.log to .gitignore",
  "",
  "## Verify",
  "3 [ ] `git check-ignore .tmp/x a.log` prints both",
  "",
].join("\n");

/** A session in a fresh workspace that ran `mode` (a slash command, or "" for none), then asked for a plan. */
export function modeSession(kit: OrchestrateKit, sid: string, mode: string): { s: HookSession; ws: string } {
  const ws = kit.temp();
  const s = claudeSession(kit, ws, sid);

  if (mode !== "") s.say(mode);
  s.say("plan it");

  return { s, ws };
}

/** The Stop block of an away run of one item: `key` names it, `step` is its run text. */
export function runBlock(key: string, step: string): { decision: string; reason: string } {
  return { decision: "block", reason: `${AWAY_RUN_REASON}; i approves ${key}: ${key}: ${step}` };
}

/** The decision line an away run logs for `key`; `strategy` only for a full plan or roadmap. */
export function decisionLine(key: string, strategy?: string): string {
  const choice = strategy === undefined ? "i" : `i (strategy ${strategy})`;

  return `- decision: approval of ${key} under /away → ${choice}, because ${WHY}`;
}

/** The away run stamp of session `sid` in `ws`. */
export function awayRunStamp(ws: string, sid: string): string {
  return path.join(ws, ORCHESTRATOR_LOGS_DIR, `${AWAY_RUN_STAMP}-${sid}`);
}

