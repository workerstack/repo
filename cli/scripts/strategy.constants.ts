/** The strategy domain's values, approval-block and reply patterns, and stamp layout. */
import type { ApprovalReply, ApprovalAction, Effort, Approval, ReviewKind, Strategy } from "./strategy.types.ts";

export const FREE_STRATEGY = "free";
export const SPAWN_FAST = "spawn-fast";
const SPAWN_DEEP = "spawn-deep";
export const STRATEGIES: readonly Strategy[] = [FREE_STRATEGY, SPAWN_FAST, SPAWN_DEEP];

const ASK: Approval = "ask";
const AWAY: Approval = "away";

export const APPROVALS: readonly Approval[] = [ASK, AWAY];

/**
 * Harnesses whose child and parent payloads differ by a marker the gate reads, so the review deny is enforced.
 * Phase 6 probe (live, 2026-11-07):
 *   claude  child has agent_id and agent_type; Grok's wire shape is Claude's (`harnessOf` says claude), and its child
 *           has subagentType, so "claude" covers Grok too
 *   codex   child has agent_id and agent_type
 *   antigravity, cursor  a child carries no marker; it only has a different session id. Not enforced.
 */
export const ENFORCED_HARNESSES: ReadonlySet<"claude" | "codex" | "antigravity" | "cursor"> = /* @__PURE__ */ new Set<
  "claude" | "codex" | "antigravity" | "cursor"
>(["claude", "codex"]);

export const IMPLEMENTER_FAST = "implementer-fast";
export const IMPLEMENTER_DEEP = "implementer-deep";

/** The words after `h` that pick a spawn strategy for the fresh session. */
const FAST = "fast";
const DEEP = "deep";

export const EFFORTS: readonly Effort[] = [FAST, DEEP];
export const NOT_FOUND = -1;
export const HANDOFF_LETTER = "h";
export const ITEM_SEP = ", then ";

/** The approval block: a fence, the header, then rows that never change. */
export const BLOCK_FENCE = "```";

/** What a reply that is no choice is told to send instead. */
export const NOT_A_CHOICE = "reply i or h, alone or with free, fast or deep";

export const BLOCK_ROWS: readonly string[] = [
  "  i  implement    i free · i fast · i deep",
  "  h  hand off     h free · h fast · h deep",
  "     or reply to revise",
];

/** One advice row under the header: `  plan 4 advice: spawn-deep because ...`. */
export const ADVICE_ROW_RE: RegExp = /^ {2}(plan|roadmap|fast-plan|fast-roadmap) (\d+) advice: (.+)$/;

/** Where a block's header and the rows after it sit, counted from its opening fence. */
export const HEADER_AT = 1;
export const AFTER_HEADER = 2;

export const HEADER_SEP = " · ";

/** One header item, such as `plan 4 · spawn-fast`. The kind and strategy words stay open; `headerItem` narrows both. */
export const HEADER_ITEM_RE: RegExp = /^([a-z]+(?:-[a-z]+)*) (\d+) · ([a-z-]+)$/;

export const LINE_END_WS_RE: RegExp = /[^\S\n]+$/;

/** Reply grammar: exact whole replies, then an action word and strategy words, each exact or inferred. */
export const TRAILING_PUNCT_RE: RegExp = /[.!]+$/;
export const WORD_SEP_RE: RegExp = /\s+/;

/** A retired letter code such as `isf` or `hd`, or one close to it: it is no choice, so the block comes back. */
export const CODE_NEAR_MISS_RE: RegExp = /^[ih](?:s[a-z]?|[fd])$/;
export const MAX_REPLY_WORDS = 4;
export const MAX_STRATEGY_WORDS = 2;
export const MAX_ACTION_WORDS = 2;
export const INFER_MAX_DISTANCE = 2;
export const INFER_MIN_LENGTH = 4;
export const IMPLEMENT_LETTERS: readonly string[] = ["i", "y"];

/** Every whole reply that needs no inference: a short yes or `h`, with no strategy word. */
export const EXACT_REPLIES: ReadonlyMap<string, ApprovalReply> = /* @__PURE__ */ new Map<string, ApprovalReply>([
  ["i", { kind: "approve", strategy: null }],
  ["y", { kind: "approve", strategy: null }],
  ["yes", { kind: "approve", strategy: null }],
  ["go", { kind: "approve", strategy: null }],
  ["do it", { kind: "approve", strategy: null }],
  ["h", { kind: "handoff", strategy: null }],
]);

/** Words that name an action, each exact or within the inference distance. */
export const ACTION_WORDS: readonly (readonly [string, ApprovalAction])[] = [
  ["implement", "approve"],
  ["hand off", "handoff"],
  ["handoff", "handoff"],
];

/** Words that name a strategy once an action is there; `fast` and `deep` are the handoff shorthands. */
export const STRATEGY_WORDS: readonly (readonly [string, Strategy])[] = [
  [FREE_STRATEGY, FREE_STRATEGY],
  [SPAWN_FAST, SPAWN_FAST],
  [SPAWN_DEEP, SPAWN_DEEP],
  [FAST, SPAWN_FAST],
  [DEEP, SPAWN_DEEP],
];

/** The folder under a session dir that holds one review stamp per spawn plan the session saved. */
export const REVIEWS_DIR = "reviews";
export const STAMP_EXT = ".json";

/** The order the deny names running reviews in: plans, then fast plans. */
export const REVIEW_KIND_ORDER: Readonly<Record<ReviewKind, number>> = { "fast-plan": 1, plan: 0 };

/** The plan folders a review stamp may point into, by the kind of plan each holds. */
export const PLAN_DIRS = { "fast-plan": "plans-fast", plan: "plans" } as const;
export const UNSAFE_SID_RE: RegExp = /[^\w-]/g;
export const FRONTMATTER_RE: RegExp = /^---\r?\n([\s\S]*?)\r?\n---/;
export const LINE_BREAK_RE: RegExp = /\r?\n/;
export const FM_LINE_RE: RegExp = /^([a-z]+):\s*(.*)$/;
export const IN_PROGRESS = "in-progress";

/** The approval picker: the Stop reason's lead line, the two questions and what each option says. */
export const PICKER_LINE: string =
  "call AskUserQuestion with exactly this input, then act on the answer; " +
  "with no AskUserQuestion tool, end with this block:";

export const APPROVAL_HEADER = "Approval";
export const STRATEGY_HEADER = "Strategy";
export const STRATEGY_QUESTION = "Which strategy?";
export const APPROVAL_ASK = ": implement it here, or hand it off?";
export const IMPLEMENT_LABEL = "Implement";
export const HANDOFF_LABEL = "Hand off";
export const AS_SAVED_LABEL = "as saved";
export const SAVED_NOTE = "saved in the file";
export const ADVICE_NOTE_SEP = "; ";
export const ADVICE_BECAUSE_RE: RegExp = /^(\S+) because (.+)$/;
export const OPTION_ORDER: readonly Strategy[] = [SPAWN_FAST, SPAWN_DEEP, FREE_STRATEGY];

export const STRATEGY_MEANING: Readonly<Record<Strategy, string>> = {
  free: "this session does every phase itself",
  "spawn-deep": "deep agents do each phase",
  "spawn-fast": "fast agents do each phase and escalate to deep when stuck",
};

/** The statuses a stamped plan keeps its stamp at; any other prunes it. */
export const STAMP_STATUSES: ReadonlySet<string> = /* @__PURE__ */ new Set(["ready", IN_PROGRESS]);
