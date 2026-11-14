/**
 * The approval picker on Claude Code: whether Stop asks for it, the PreToolUse gate that holds the agent to the exact
 * input, and the PostToolUse answer that settles a click as a typed `i` or `h` would.
 */
import { isDeepStrictEqual } from "node:util";

import type { AgentDefaults } from "../config-resolved.types.ts";
import { repoEnv } from "../repo-env.ts";
import { askInputSchema, isApprovalPicker, pickerInput, pickerReply, type AskInput } from "./approval-picker.ts";
import { firstNonEmpty } from "./first-non-empty.ts";
import { eventKey, harnessOf } from "./gate-harness.ts";
import type { HookInput } from "./hook-input.ts";
import { approvableItems, settledReply } from "./orchestrate-approvals.ts";
import { denyWith, PASS, replyWith } from "./orchestrate-reply.ts";
import { queueText } from "./orchestrate-reviews.ts";
import { unlinkStamp } from "./orchestrate-stamps.ts";
import { APPROVAL_BLOCK_STAMP, ASK_TOOL } from "./orchestrate.constants.ts";
import type { HookResult } from "./orchestrate.types.ts";
import { effectiveSettings } from "./session-settings.ts";
import type { Approvable, Approval, ItemKind } from "./strategy.types.ts";

const AWAY_DENY = "under away the hook runs the approval block's header choice; end the reply with the approval block";
const NOTHING_DENY = "nothing waits for approval; ask no approval picker";

/** The review command of each kind that has one; a fast item has none. */
const REVIEW_COMMAND: Readonly<Partial<Record<ItemKind, string>>> = {
  plan: "/review-plan",
  roadmap: "/review-roadmap",
};

/** True when Stop may ask for the picker: a Claude payload outside a Grok event, and not under away. */
export function offersPicker(data: HookInput, approval: Approval): boolean {
  return (
    harnessOf(data) === "claude" && firstNonEmpty(repoEnv.process.GROK_HOOK_EVENT) === undefined && approval !== "away"
  );
}

/** The approval picker this tool call carries, or null for any other tool or picker. */
function approvalPickerOf(data: HookInput): AskInput | null {
  if (eventKey(firstNonEmpty(data.toolName, data.tool_name) ?? "") !== ASK_TOOL) return null;
  const parsed = askInputSchema.safeParse(data.toolInput ?? data.tool_input);

  return parsed.success && isApprovalPicker(parsed.data) ? parsed.data : null;
}

/**
 * PreToolUse for AskUserQuestion: an approval picker is denied under away, when nothing waits, and when it differs from
 * the rendered one. Null leaves the call to the normal gate. Writes nothing.
 */
export function pickerGate(data: HookInput, defaults: AgentDefaults): HookResult | null {
  if (approvalPickerOf(data) === null) return null;

  if (effectiveSettings(data, defaults).approval === "away") return denyWith(data, AWAY_DENY);
  const items = approvableItems(data);

  if (items.length === 0) return denyWith(data, NOTHING_DENY);
  const rendered = pickerInput(items);

  return isDeepStrictEqual(data.toolInput ?? data.tool_input, rendered)
    ? null
    : denyWith(data, `the approval picker must be exactly this input:\n${JSON.stringify(rendered)}`);
}

/** What to do with feedback on `named`: revise each item, run its review again if it has one, then stop again. */
function feedbackLine(text: string, named: Approvable[]): string {
  const reviews = named.flatMap((n) =>
    REVIEW_COMMAND[n.kind] === undefined ? [] : [`${REVIEW_COMMAND[n.kind]} ${n.serial}`],
  );

  const revise = named.length > 1 ? "revise each" : "revise it";
  const again = reviews.length === 0 ? ", then" : `, run ${reviews.join(" and ")} again, then`;

  return `"${text}" is feedback on ${queueText(named)}: ${revise}${again} stop for approval again`;
}

/**
 * PostToolUse for AskUserQuestion: a click settles as the typed reply it stands for; a typed answer is feedback, which
 * lets the next Stop ask again. Any other tool or picker passes.
 */
export function pickerAnswer(data: HookInput, defaults: AgentDefaults): HookResult {
  const input = approvalPickerOf(data);
  const answer = input === null ? null : pickerReply(input);

  if (answer === null) return PASS;

  if ("feedback" in answer) unlinkStamp(data, APPROVAL_BLOCK_STAMP);

  const text =
    "feedback" in answer ? feedbackLine(answer.feedback, answer.named) : settledReply(data, answer, defaults);

  return text === ""
    ? PASS
    : replyWith({ hookSpecificOutput: { additionalContext: text, hookEventName: "PostToolUse" } });
}
