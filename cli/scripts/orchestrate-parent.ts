#!/usr/bin/env bun
/**
 * PreToolUse fat-gate + persist rewrite. Stop writes session receipt. SubagentStop intercepts need:
 * search|exec|slice|fetch. Fail-open: parse/crash → empty stdout, exit 0.
 */
import { AGENT_DEFAULTS } from "../agent-defaults.constants.ts";
import { agentDefaults } from "../agent-defaults.ts";
import type { AgentDefaults } from "../config-resolved.types.ts";
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
import { parentWrite, savesNewItem } from "./orchestrate-writes.ts";
import { DEFAULTS_EVENTS, PRE_TOOL_USE, SPAWN_TOOLS, WRITE_TOOLS } from "./orchestrate.constants.ts";
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

function writeUse(data: HookInput, toolInput: ToolArgs | undefined, defaults: AgentDefaults): HookResult | null {
  // A full-content plan Write is answered below, before the gate sees it, so the stamp is written here.
  if (isString(toolInput?.content)) stampPlanSave(data);

  return parentWrite(data, toolInput, defaults);
}

/** Every other tool call, and a write the parent leaves to the host: the fat gate, then a lessons notice. */
function gateUse(data: HookInput, toolInput: ToolArgs | undefined, { writes }: { writes: boolean }): HookResult {
  notePush(data, toolInput);
  const fat = fatHookOutput(data, processFatTools(data));

  if (fat !== null) return replyWith(fat);
  const notice = toolInput !== undefined && writes ? lessonNotice(data, toolInput) : null;

  return notice === null ? PASS : replyWith(notice);
}

function toolKeyOf(data: HookInput): string {
  return eventKey(firstNonEmpty(data.toolName, data.tool_name) ?? "");
}

function preToolUse(data: HookInput, defaults: AgentDefaults): HookResult {
  const toolKey = toolKeyOf(data);
  const toolInput = data.toolInput ?? data.tool_input;

  if (SPAWN_TOOLS.has(toolKey)) return spawnUse(data, toolInput);
  const writes = WRITE_TOOLS.has(toolKey);
  const persisted = writes ? writeUse(data, toolInput, defaults) : null;

  return persisted ?? gateUse(data, toolInput, { writes });
}

/** The handler for each event, by eventKey of the event name. */
const ROUTES: ReadonlyMap<string, (data: HookInput, defaults: AgentDefaults) => HookResult> = /* @__PURE__ */ new Map([
  [PRE_TOOL_USE, preToolUse],
  ["userpromptsubmit", userPromptSubmit],
  ["beforesubmitprompt", beforeSubmitPrompt],
  ["stop", stop],
  ["subagentstop", (data: HookInput) => interceptNeed(data, "SubagentStop")],
]);

function eventOf(data: HookInput): string {
  return eventKey(firstNonEmpty(repoEnv.process.GROK_HOOK_EVENT, data.hookEventName, data.hook_event_name) ?? "");
}

/** Whether an event's answer reads the agents defaults: a prompt, a Stop, and a Write of a new plan or roadmap. */
function readsDefaults(event: string, data: HookInput): boolean {
  if (DEFAULTS_EVENTS.has(event)) return true;

  return (
    event === PRE_TOOL_USE && WRITE_TOOLS.has(toolKeyOf(data)) && savesNewItem(data, data.toolInput ?? data.tool_input)
  );
}

/** Answers one event on `defaults` and prints the reply; the exit code the host reads. */
function answer(data: HookInput, defaults: AgentDefaults, io: HookIo): number {
  const result = ROUTES.get(eventOf(data))?.(data, defaults) ?? PASS;

  if (result.reply !== undefined) io.write(JSON.stringify(result.reply));

  return result.code;
}

/** The hook run on `defaults` as given, with no config load: what `main` does once it has them. */
export function mainWith(defaults: AgentDefaults): (argv: string[] | undefined, io: HookIo) => number {
  return (_argv, io) => {
    try {
      return answer(readHookInput(io) ?? {}, defaults, io);
    } catch {
      return 0;
    }
  };
}

/** The hook: an event that reads the agents defaults loads them from the workspace's config first. */
export async function main(_argv?: string[], io: HookIo = processHookIo()): Promise<number> {
  try {
    const data = readHookInput(io) ?? {};
    const reads = readsDefaults(eventOf(data), data);
    const defaults = reads ? await agentDefaults(resolveRoots(data).root) : AGENT_DEFAULTS;

    return answer(data, defaults, io);
  } catch {
    return 0;
  }
}
