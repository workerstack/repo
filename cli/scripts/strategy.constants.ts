/** The strategy domain's values, approval-block and reply patterns, and stamp layout. */
import type { Approval, ApprovalAction, Effort, Mode, Strategy } from "./strategy.types.ts";

export const FREE_STRATEGY = "free";
export const SPAWN_FAST = "spawn-fast";
const SPAWN_DEEP = "spawn-deep";
export const STRATEGIES: readonly Strategy[] = [FREE_STRATEGY, SPAWN_FAST, SPAWN_DEEP];

export const ASK_MODE: Mode = "ask";
export const AWAY_MODE: Mode = "away";

export const MODES: readonly Mode[] = [ASK_MODE, AWAY_MODE];

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

export const PLAN = "plan";
export const ROADMAP = "roadmap";
export const FAST_PLAN = "fast-plan";
export const FAST_ROADMAP = "fast-roadmap";

/** The words after `h` that pick a spawn strategy for the fresh session. */
const FAST = "fast";
const DEEP = "deep";

export const EFFORTS: readonly Effort[] = [FAST, DEEP];
export const NOT_FOUND = -1;
export const HANDOFF_LETTER = "h";
export const ITEM_SEP = ", then ";

/** The approval block: a fence, the header, then rows that never change. */
export const BLOCK_FENCE = "```";

export const BLOCK_ROWS: readonly string[] = [
  "  i  implement    if · isf · isd",
  "  h  hand off     hf · hsf · hsd",
  "     or reply to revise",
];

/** The rows of a block that names only fast plans: no codes, because a fast plan has no strategy. */
export const FAST_BLOCK_ROWS: readonly string[] = ["  i  implement", "  h  hand off", "     or reply to revise"];

export const HEADER_SEP = " · ";

/**
 * One header item: `plan 4 · spawn-fast` or `fast-plan 3`. The kind and whether a strategy follows stay open here;
 * `parseClosingBlock` narrows both.
 */
export const HEADER_ITEM_RE: RegExp = /^([a-z]+(?:-[a-z]+)*) (\d+)(?: · ([a-z-]+))?$/;

export const LINE_END_WS_RE: RegExp = /[^\S\n]+$/;

/** Reply grammar: exact whole replies, then an action word and strategy words, each exact or inferred. */
export const TRAILING_PUNCT_RE: RegExp = /[.!]+$/;
export const WORD_SEP_RE: RegExp = /\s+/;

/** A word shaped like a code but none, such as `isx`, or a code with its `s` dropped (`id` for `isd`). */
export const CODE_NEAR_MISS_RE: RegExp = /^[ih](?:s[a-z]?|[fd])$/;
export const MAX_REPLY_WORDS = 4;
export const MAX_STRATEGY_WORDS = 2;
export const MAX_ACTION_WORDS = 2;
export const INFER_MAX_DISTANCE = 2;
export const INFER_MIN_LENGTH = 4;
export const IMPLEMENT_LETTERS: readonly string[] = ["i", "y"];

/** Every whole reply that needs no inference. */
export const EXACT_REPLIES: ReadonlyMap<string, Approval> = /* @__PURE__ */ new Map<string, Approval>([
  ["i", { kind: "approve", strategy: null }],
  ["y", { kind: "approve", strategy: null }],
  ["yes", { kind: "approve", strategy: null }],
  ["go", { kind: "approve", strategy: null }],
  ["do it", { kind: "approve", strategy: null }],
  ["h", { kind: "handoff", strategy: null }],
  ["if", { kind: "approve", strategy: "free" }],
  ["isf", { kind: "approve", strategy: "spawn-fast" }],
  ["isd", { kind: "approve", strategy: "spawn-deep" }],
  ["hf", { kind: "handoff", strategy: "free" }],
  ["hsf", { kind: "handoff", strategy: "spawn-fast" }],
  ["hsd", { kind: "handoff", strategy: "spawn-deep" }],
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

export const STAMP_FILE = "strategy.json";
export const UNSAFE_SID_RE: RegExp = /[^\w-]/g;
export const FRONTMATTER_RE: RegExp = /^---\r?\n([\s\S]*?)\r?\n---/;
export const LINE_BREAK_RE: RegExp = /\r?\n/;
export const FM_LINE_RE: RegExp = /^([a-z]+):\s*(.*)$/;
export const IN_PROGRESS = "in-progress";
