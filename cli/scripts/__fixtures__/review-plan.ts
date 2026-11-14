// A review plan on disk and a session stamped to it, as the gate's review suites set them up.
import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import type { HookOutput, ToolArgs } from "../gate-harness.ts";
import type { HookInput } from "../hook-input.ts";
import { AGENT_DEFAULTS } from "../../agent-defaults.constants.ts";
import { mainWith } from "../orchestrate-parent.ts";
import { stampPlan, stampedPlans } from "../review-stamps.ts";
import { camelCall, inSession, kindWrite, replyOf, type WriteKind } from "./hook-payload.ts";
import { runHook } from "./run-hook.ts";

/** The parent hook on the built-in agents defaults, answered in this process. */
const orchMain = mainWith(AGENT_DEFAULTS);

/** The session every review suite stamps. */
export const REVIEW_SID = "rv1";

export const IMPLEMENTER_WRITE =
  "implementer writes product files and tests only; the reviewer writes the plan and the journal";
export const IMPLEMENTER_GIT = "implementer never stages or commits; report the changed files and the reviewer stages them";

/** The deny a parent product write gets while a review of `strategy` runs. */
export function reviewReason(strategy: string): string {
  const implementer = strategy === "spawn-fast" ? "implementer-fast" : "implementer-deep";
  return `plan 3 runs strategy ${strategy}: this session reviews. Spawn ${implementer} for product writes; the plan, the journal and .repo/ work dirs stay writable.`;
}

/** Plan `serial` (default 3) with `strategy` and `status` in its front matter. */
export function planText(strategy: string, status: string, serial = 3): string {
  return `---\nserial: ${serial}\nname: review-plan\nstatus: ${status}\nreviews: 1\ncreated: 2026-11-07T18:19:01Z\nsource: "t"\ncommit: feat: x\nstrategy: ${strategy}\n---\n\n# review-plan\n\n1.1 [ ] a\n`;
}

/** Where a plan or fast plan lives, and its serial; plan 3 when left out. */
export type PlanAt = { fast?: boolean; serial?: number };

/** Writes plan 3, or the plan or fast plan `at` names, under `root` and returns its path and text. */
export function planFile(root: string, strategy: string, status = "in-progress", at: PlanAt = {}) {
  const serial = at.serial ?? 3;
  const name = at.fast === true ? `plans-fast/${serial}-review-plan-20261113T030000Z.md` : `plans/${serial}-review-plan-20261107T181901Z.md`;
  const file = path.join(root, ".repo", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = planText(strategy, status, serial);
  fs.writeFileSync(file, text);
  return { file, text };
}

/** A session (default: the review suites') stamped to a plan (default: plan 3) holding `strategy` at `status`; returns the plan's path. */
export function startReview(
  root: string,
  spec: { strategy?: string; status?: string; sid?: string } & PlanAt = {},
): string {
  const { file } = planFile(root, spec.strategy ?? "spawn-fast", spec.status ?? "in-progress", spec);
  stampPlan(root, spec.sid ?? REVIEW_SID, file);
  return file;
}

/** A write of `spec.target` in the wire shape of `kind`, sent by the review session. */
export function reviewWrite(kind: WriteKind, spec: { cwd: string; target: string; content?: string }): HookInput {
  return inSession(kindWrite(kind, spec), REVIEW_SID);
}

/** Whether the review session has a stamp under `root`. */
export function stamped(root: string): boolean {
  return stampedPlans(root, REVIEW_SID).length > 0;
}

/** A Write, Edit or other call as Grok sends it through orchestrate-parent, answered in `root`. */
export function grokReply(root: string, call: { tool: string; input: ToolArgs; extra?: HookInput }): HookOutput | null {
  const payload = camelCall(call.tool, call.input, {
    hookEventName: "PreToolUse",
    workspaceRoot: root,
    session_id: REVIEW_SID,
    ...call.extra,
  });
  const env = { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: root, CLAUDE_PROJECT_DIR: "" };
  const out = runHook(orchMain, payload, env);
  expect(out.status).toBe(0);
  return replyOf(out.stdout);
}
