#!/usr/bin/env bun
import { answerDeny, answerRewrite, type HookOutput } from "./gate-harness.ts";
/** PreToolUse: intent-scrub spawn `prompt`. Fail-open: unchanged/error → empty stdout, exit 0. */
import type { HookInput } from "./hook-input.ts";
import { processHookIo, readHookInput, type HookIo } from "./hook-io.ts";
import { scrubText } from "./scrub-text-lib.ts";
import { resolveRoots } from "./workspace-root.ts";

/** What the hook prints: a deny or a rewrite, in whichever shape the harness takes. */
export type SpawnAnswer = HookOutput;

export const MAX_PROMPT_CHARS = 100000;
export const TRUNCATE_SUFFIX = "…[truncated]";
const TRANSCRIPT_PREFIX = /^\s*(?:\[(?:orchestrator|scout)\]:|Human:|Assistant:)\s*/i;
const YOU_ARE_SUBAGENT = /^\s*You are scout subagent\b/;
const LEADING_YOU_ARE = /^\s*You are scout subagent\b[^.]*\.?\s*/;
const BLANK_RUN = /[ \t]{2,}/g;

export function stripTranscripts(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let hasKeptYouAre = false;
  for (const line of lines) {
    if (TRANSCRIPT_PREFIX.test(line)) continue;
    if (YOU_ARE_SUBAGENT.test(line)) {
      if (hasKeptYouAre) continue;
      hasKeptYouAre = true;
    }
    out.push(line);
  }
  return out.join("\n");
}

export function spawnCapReason(workspaceRoot?: string): string {
  const root = workspaceRoot !== undefined && workspaceRoot !== "" ? workspaceRoot : resolveRoots().root;
  return (
    `spawn prompt exceeds ${MAX_PROMPT_CHARS} chars after scrub; ` +
    `write it under ${root}/.tmp/repo/plans/ and re-spawn with that abs path`
  );
}

const INLINE_TRANSCRIPT = /\s*(?:\[(?:orchestrator|scout)\]:|Human:|Assistant:)\s*/gi;
const EXTRA_YOU_ARE = /\s*You are scout subagent\b[^.]*\.?/g;

export function stripInlineTranscripts(text: string): string {
  const first = LEADING_YOU_ARE.exec(text);
  const prefix = first === null ? "" : first[0];
  let rest = text.slice(prefix.length);
  rest = rest.replaceAll(INLINE_TRANSCRIPT, " ");
  rest = rest.replaceAll(EXTRA_YOU_ARE, " ");
  return (prefix + rest).replaceAll(BLANK_RUN, " ").trim();
}

export function capSpawnPrompt(prompt: string): string {
  let s = stripTranscripts(prompt);
  s = scrubText(s);
  s = stripTranscripts(s);
  s = stripInlineTranscripts(s);
  return s.trim();
}

export function rewriteSpawnToolInput(toolInput: unknown): Record<string, unknown> | null {
  if (!isRecord(toolInput)) return null;

  const next: Record<string, unknown> = Object.assign({}, toolInput);
  let isChanged = false;

  if (typeof next.prompt === "string") {
    const scrubbed = capSpawnPrompt(next.prompt);
    if (scrubbed !== next.prompt) {
      next.prompt = scrubbed;
      isChanged = true;
    }
  }

  return isChanged ? next : null;
}

/** The prompt the spawn goes out with: the rewritten one, else the one sent. */
function sentPrompt(updated: Record<string, unknown> | null, toolInput: unknown): unknown {
  // A rewrite only happens for a string prompt, so `updated.prompt` is that string.
  return updated?.prompt ?? (isRecord(toolInput) ? toolInput.prompt : undefined);
}

export function processHookPayload(data: HookInput | null | undefined): SpawnAnswer | null {
  if (!isRecord(data)) return null;
  const toolInput: unknown = data.toolInput ?? data.tool_input;
  const updated = rewriteSpawnToolInput(toolInput);
  const prompt = sentPrompt(updated, toolInput);
  if (typeof prompt === "string" && prompt.length > MAX_PROMPT_CHARS)
    return answerDeny(data, spawnCapReason(resolveRoots(data).root));
  return updated === null ? null : answerRewrite(data, updated);
}

export function main(_argv: string[] = [], io: HookIo = processHookIo()): number {
  try {
    const data = readHookInput(io);
    const answer = processHookPayload(data);
    if (answer !== null) io.write(JSON.stringify(answer));
    return 0;
  } catch {
    return 0;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
