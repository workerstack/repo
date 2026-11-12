#!/usr/bin/env bun
/**
 * PreToolUse fat-gate + persist rewrite. Stop writes session receipt. SubagentStop intercepts need:
 * search|exec|slice|fetch. Fail-open: parse/crash → empty stdout, exit 0.
 */
import { isString } from "../json.ts";
import { repoEnv } from "../repo-env.ts";
import { notePush } from "./ci-push-gate.ts";
import { firstNonEmpty } from "./first-non-empty.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import { answerDeny, answerRewrite, eventKey, fatHookOutput, type HookOutput, type ToolArgs } from "./gate-harness.ts";
import { stampPlanSave } from "./gate-review.ts";
import type { HookInput } from "./hook-input.ts";
import { processHookIo, readHookInput, type HookIo } from "./hook-io.ts";
import { interceptNeed } from "./orchestrate-intercept.ts";
import { lessonNotice } from "./orchestrate-lessons.ts";
import { PASS, replyWith } from "./orchestrate-reply.ts";
import { recordReviewSpawn } from "./orchestrate-reviews.ts";
import { beforeSubmitPrompt, stop, userPromptSubmit } from "./orchestrate-stop.ts";
import { parentWrite } from "./orchestrate-writes.ts";
import { SPAWN_TOOLS, WRITE_TOOLS } from "./orchestrate.constants.ts";
import type { HookResult } from "./orchestrate.types.ts";
import { MAX_PROMPT_CHARS, rewriteSpawnToolInput, spawnCapReason } from "./scrub-spawn-prompt.ts";
import { resolveRoots } from "./workspace-root.ts";

function promptOf(input: ToolArgs | null | undefined): string | null {
  const prompt = input?.prompt;

  return isString(prompt) ? prompt : null;
}

/** A spawn over the prompt cap is denied; otherwise the scrubbed input, or null when nothing changed. */
function rewriteSpawn(
  toolInput: ToolArgs | undefined,
  data: HookInput,
): { deny: HookOutput } | { updated: ToolArgs | null } {
  const updated = rewriteSpawnToolInput(toolInput);
  const prompt = promptOf(updated) ?? promptOf(toolInput) ?? "";

  if (prompt.length > MAX_PROMPT_CHARS) return { deny: answerDeny(data, spawnCapReason(resolveRoots(data).root)) };

  return { updated };
}

function spawnUse(data: HookInput, toolInput: ToolArgs | undefined): HookResult {
  const verdict = rewriteSpawn(toolInput, data);

  if ("deny" in verdict) return replyWith(verdict.deny);
  recordReviewSpawn(data, toolInput);

  return verdict.updated === null ? PASS : replyWith(answerRewrite(data, verdict.updated));
}

function writeUse(data: HookInput, toolInput: ToolArgs | undefined): HookResult | null {
  // A full-content plan Write is answered below, before the gate sees it, so the stamp is written here.
  if (isString(toolInput?.content)) stampPlanSave(data);

  return parentWrite(data, toolInput);
}

/** Every other tool call, and a write the parent leaves to the host: the fat gate, then a lessons notice. */
function gateUse(data: HookInput, toolInput: ToolArgs | undefined, { writes }: { writes: boolean }): HookResult {
  notePush(data, toolInput);
  const fat = fatHookOutput(data, processFatTools(data));

  if (fat !== null) return replyWith(fat);
  const notice = toolInput !== undefined && writes ? lessonNotice(data, toolInput) : null;

  return notice === null ? PASS : replyWith(notice);
}

function preToolUse(data: HookInput): HookResult {
  const toolKey = eventKey(firstNonEmpty(data.toolName, data.tool_name) ?? "");
  const toolInput = data.toolInput ?? data.tool_input;

  if (SPAWN_TOOLS.has(toolKey)) return spawnUse(data, toolInput);
  const writes = WRITE_TOOLS.has(toolKey);
  const persisted = writes ? writeUse(data, toolInput) : null;

  return persisted ?? gateUse(data, toolInput, { writes });
}

/** The handler for each event, by eventKey of the event name. */
const ROUTES: ReadonlyMap<string, (data: HookInput) => HookResult> = /* @__PURE__ */ new Map([
  ["pretooluse", preToolUse],
  ["userpromptsubmit", userPromptSubmit],
  ["beforesubmitprompt", beforeSubmitPrompt],
  ["stop", stop],
  ["subagentstop", (data: HookInput) => interceptNeed(data, "SubagentStop")],
]);

export function main(_argv?: string[], io: HookIo = processHookIo()): number {
  try {
    const data = readHookInput(io) ?? {};

    const event = eventKey(
      firstNonEmpty(repoEnv.process.GROK_HOOK_EVENT, data.hookEventName, data.hook_event_name) ?? "",
    );

    const result = ROUTES.get(event)?.(data) ?? PASS;

    if (result.reply !== undefined) io.write(JSON.stringify(result.reply));

    return result.code;
  } catch {
    return 0;
  }
}
