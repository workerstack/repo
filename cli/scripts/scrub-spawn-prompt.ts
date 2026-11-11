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

export function stripTranscripts(text: string): string {
  const lines = String(text).split(/\n/);
  const out: string[] = [];
  let keptYouAre = false;
  for (const line of lines) {
    if (TRANSCRIPT_PREFIX.test(line)) continue;
    if (YOU_ARE_SUBAGENT.test(line)) {
      if (keptYouAre) continue;
      keptYouAre = true;
    }
    out.push(line);
  }
  return out.join("\n");
}

export function spawnCapReason(workspaceRoot?: string) {
  const root = workspaceRoot || resolveRoots().root;
  return `spawn prompt exceeds ${MAX_PROMPT_CHARS} chars after scrub; write it under ${root}/.tmp/repo/plans/ and re-spawn with that abs path`;
}

const INLINE_TRANSCRIPT = /\s*(?:\[(?:orchestrator|scout)\]:|Human:|Assistant:)\s*/gi;
const EXTRA_YOU_ARE = /\s*You are scout subagent\b[^.]*\.?/g;

export function stripInlineTranscripts(text: string): string {
  let s = String(text);
  const first = s.match(/^\s*You are scout subagent\b[^.]*\.?\s*/);
  const prefix = first ? first[0] : "";
  let rest = first ? s.slice(first[0].length) : s;
  rest = rest.replace(INLINE_TRANSCRIPT, " ");
  rest = rest.replace(EXTRA_YOU_ARE, " ");
  return (prefix + rest).replace(/[ \t]{2,}/g, " ").trim();
}

export function capSpawnPrompt(prompt: string): string {
  let s = stripTranscripts(String(prompt));
  s = scrubText(s);
  s = stripTranscripts(s);
  s = stripInlineTranscripts(s);
  return s.trim();
}

export function rewriteSpawnToolInput(toolInput: unknown): Record<string, unknown> | null {
  if (!isRecord(toolInput)) {
    return null;
  }

  const next: Record<string, unknown> = Object.assign({}, toolInput);
  let changed = false;

  if (typeof next.prompt === "string") {
    const scrubbed = capSpawnPrompt(next.prompt);
    if (scrubbed !== next.prompt) {
      next.prompt = scrubbed;
      changed = true;
    }
  }

  return changed ? next : null;
}

export function processHookPayload(data: HookInput | null | undefined): SpawnAnswer | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  let toolInput: unknown = data.toolInput;
  toolInput ??= data.tool_input;
  const updated = rewriteSpawnToolInput(toolInput);
  // A rewrite only happens for a string prompt, so `updated.prompt` is that string.
  const prompt = updated?.prompt ?? (isRecord(toolInput) ? toolInput.prompt : undefined);
  if (typeof prompt === "string" && prompt.length > MAX_PROMPT_CHARS) {
    return answerDeny(data, spawnCapReason(resolveRoots(data).root));
  }
  return updated ? answerRewrite(data, updated) : null;
}

export function main(_argv: string[] = [], io: HookIo = processHookIo()): number {
  try {
    const data = readHookInput(io);
    const answer = processHookPayload(data);
    if (answer) io.write(JSON.stringify(answer));
    return 0;
  } catch {
    return 0;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
