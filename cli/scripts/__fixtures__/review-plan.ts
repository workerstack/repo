// A review plan on disk and a session stamped to it, as the gate's review suites set them up.
import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { isPlainObject, type HookOutput, type ToolArgs } from "../gate-harness.ts";
import type { HookInput } from "../hook-input.ts";
import { main as orchMain } from "../orchestrate-parent.ts";
import { stampPath, writeStamp } from "../strategy.ts";
import { camelCall, inSession, kindWrite, replyOf, type WriteKind } from "./hook-payload.ts";
import { runHook } from "./run-hook.ts";

/** The session every review suite stamps. */
export const REVIEW_SID = "rv1";

export const IMPLEMENTER_WRITE =
  "implementer writes product files and tests only; the reviewer writes the plan and the journal";
export const IMPLEMENTER_GIT = "implementer never stages or commits; report the changed files and the reviewer stages them";

/** The deny a parent product write gets while a review of `strategy` runs. */
export function reviewReason(strategy: string): string {
  const implementer = strategy === "review-fast" ? "implementer-fast" : "implementer-deep";
  return `plan 3 runs strategy ${strategy}: this session reviews. Spawn ${implementer} for product writes; the plan, the journal and .tmp/ stay writable.`;
}

/** Plan 3 with `strategy` and `status` in its front matter. */
export function planText(strategy: string, status: string): string {
  return `---\nserial: 3\nname: review-plan\nstatus: ${status}\nreviews: 1\ncreated: 2026-11-07T18:19:01Z\nsource: "t"\ncommit: feat: x\nstrategy: ${strategy}\n---\n\n# review-plan\n\n1.1 [ ] a\n`;
}

/** Writes plan 3 under `root` and returns its path and text. */
export function planFile(root: string, strategy: string, status = "in-progress") {
  const file = path.join(root, ".tmp/repo/plans/3-review-plan-20261107T181901Z.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = planText(strategy, status);
  fs.writeFileSync(file, text);
  return { file, text };
}

/** A session (default: the review suites') stamped to a plan holding `strategy` at `status`; returns the plan's path. */
export function startReview(root: string, spec: { strategy?: string; status?: string; sid?: string } = {}): string {
  const { file } = planFile(root, spec.strategy ?? "review-fast", spec.status ?? "in-progress");
  writeStamp(root, spec.sid ?? REVIEW_SID, file);
  return file;
}

/** A write of `spec.target` in the wire shape of `kind`, sent by the review session. */
export function reviewWrite(kind: WriteKind, spec: { cwd: string; target: string; content?: string }): HookInput {
  return inSession(kindWrite(kind, spec), REVIEW_SID);
}

/** Whether the review session has a stamp under `root`. */
export function stamped(root: string): boolean {
  return fs.existsSync(stampPath(root, REVIEW_SID));
}

/** What the review session's stamp file holds. */
export function stampContent(root: string): ToolArgs {
  const stamp: unknown = JSON.parse(fs.readFileSync(stampPath(root, REVIEW_SID), "utf8"));
  return isPlainObject(stamp) ? stamp : {};
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
