import { readEnv } from "../env.ts";
import { otherLines, recordHook } from "./board.ts";
/** Stop blocks a reply that skips a closing line, an /ask step ask or an /away decision; a prompt resets the turn. */
import { pushHold } from "./ci-push-gate.ts";
import type { HookInput } from "./hook-input.ts";
import { approvalBlockReason, approvalContext } from "./orchestrate-approvals.ts";
import { interceptNeed, isStopActive } from "./orchestrate-intercept.ts";
import { applySessionGateSlash, effectiveModeOf, effectiveSessionContext } from "./orchestrate-mode.ts";
import { blockWith, PASS, replyWith } from "./orchestrate-reply.ts";
import { closingReviewReason } from "./orchestrate-reviews.ts";
import { approvalsFile } from "./orchestrate-session.ts";
import { readStampInt, unlinkStamp, writeStamp } from "./orchestrate-stamps.ts";
import {
  closingLineOf,
  endsWithQuestion,
  hasStepAsk,
  isWaitScoutExact,
  lastAssistantFromTranscript,
  payloadAssistantMessage,
} from "./orchestrate-transcript.ts";
import { writeGitAsked, writeSessionReceipt } from "./orchestrate-writes.ts";
import {
  APPROVAL_BLOCK_STAMP,
  ASK_STOP_REASON,
  AWAY_STOP_REASON,
  END_TURN,
  MAX_STOP,
  PUSH_BLOCK_STAMP,
  STOP_BLOCK_STAMP,
  TURN_START_STAMP,
} from "./orchestrate.constants.ts";
import type { HookResult } from "./orchestrate.types.ts";

// The ask and away blocks share one counter and its cap, so a true blocker still reaches the person.
function cappedStopBlock(data: HookInput, reason: string): HookResult {
  const n = readStampInt(data, STOP_BLOCK_STAMP);
  if (n >= MAX_STOP) return PASS;
  writeStamp(data, STOP_BLOCK_STAMP, String(n + 1));
  return blockWith(reason);
}

/** What the turn's last reply is held to: a settled closing line, then the session's mode. */
function replyVerdict(data: HookInput, msg: string): HookResult {
  const named = closingLineOf(msg);
  const reviewReason = closingReviewReason(data, named);
  if (reviewReason) return blockWith(reviewReason);
  const approvalReason = approvalBlockReason(data, msg);
  if (approvalReason) {
    writeStamp(data, APPROVAL_BLOCK_STAMP, "1");
    return blockWith(approvalReason);
  }
  const mode = effectiveModeOf(data);
  if (mode === "away" && !named && endsWithQuestion(msg)) return cappedStopBlock(data, AWAY_STOP_REASON);
  if (mode === "ask" && !hasStepAsk(msg)) return cappedStopBlock(data, ASK_STOP_REASON);
  return PASS;
}

/** True for a plain end of turn: no stop hook already blocked it, and no other stop reason. */
function endsTurn(data: HookInput): boolean {
  const reason = String(data.reason || "");
  return !isStopActive(data) && (!reason || reason === END_TURN);
}

const lastReply = (data: HookInput): string =>
  payloadAssistantMessage(data) || lastAssistantFromTranscript(data.transcript_path || data.transcriptPath || "");

export function stop(data: HookInput): HookResult {
  if (data.subagentType || data.subagent_type) return interceptNeed(data, "Stop");
  const held = pushHold(data);
  if (held) return blockWith(held);
  if (!endsTurn(data)) return PASS;
  const msg = lastReply(data);
  writeSessionReceipt(data, msg);
  return isWaitScoutExact(msg) ? PASS : replyVerdict(data, msg);
}

function userPromptOf(data: HookInput): string {
  return String(data.prompt ?? data.userPrompt ?? data.user_prompt ?? data.content ?? "");
}

function isHostStopBanner(prompt: string): boolean {
  return (
    /^\s*Stop hook feedback:/.test(prompt) ||
    /Blocked by stop hook/.test(prompt) ||
    /task[-_ ]?notification/i.test(prompt)
  );
}

// Cursor's beforeSubmitPrompt does only this: no /ask stamp, board line, approval or reply.
export function beforeSubmitPrompt(data: HookInput): HookResult {
  writeGitAsked(data, userPromptOf(data));
  return PASS;
}

/** This session's line on the board and the other sessions' lines; "" when the board cannot be read. */
function boardLines(data: HookInput): string {
  let others = "";
  try {
    recordHook(data, readEnv());
    others = otherLines(data, readEnv());
  } catch {
    // Board is best-effort. The session receipt still ships.
  }
  return others;
}

export function userPromptSubmit(data: HookInput): HookResult {
  const prompt = userPromptOf(data);
  if (isHostStopBanner(prompt)) return PASS;
  writeGitAsked(data, prompt);
  unlinkStamp(data, STOP_BLOCK_STAMP);
  unlinkStamp(data, PUSH_BLOCK_STAMP);
  const approval = approvalContext(data, prompt);
  if (approvalsFile(data)) {
    writeStamp(data, TURN_START_STAMP, String(Date.now()));
    unlinkStamp(data, APPROVAL_BLOCK_STAMP);
  }
  applySessionGateSlash(data, prompt);
  const ctx = [effectiveSessionContext(data), approval, boardLines(data)].filter(Boolean).join("\n");
  return replyWith({ hookSpecificOutput: { additionalContext: ctx, hookEventName: "UserPromptSubmit" } });
}
