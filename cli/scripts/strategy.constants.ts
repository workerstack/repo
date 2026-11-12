/** The strategy domain's values, closing-line and approval patterns, and stamp layout. */
import type { Mode, Strategy } from "./strategy.types.ts";

export const DEFAULT_STRATEGY = "default";
export const REVIEW_FAST = "review-fast";
export const REVIEW_DEEP = "review-deep";
export const STRATEGIES: readonly Strategy[] = [DEFAULT_STRATEGY, REVIEW_FAST, REVIEW_DEEP];

export const MODES: readonly Mode[] = ["ask", "auto", "away"];

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
export const HANDOFFS = '"h" / "h fast" / "h deep" for a fresh session';

/** The words after `h` that pick a review strategy for the fresh session. */
export const FAST = "fast";
export const DEEP = "deep";
export const HANDOFF_LETTER = "h";
export const ITEM_SEP = ", then ";

/** One closing-line item: `plan 4 (strategy: review-fast)`. */
const ITEM_SRC = "(?:plan|roadmap) \\d+ \\(strategy: [a-z-]+\\)";

export const CLOSING_RE: Readonly<RegExp> = /* @__PURE__ */ new RegExp(
  `^Reply "y" to run (${ITEM_SRC}(?:, then ${ITEM_SRC})*), or `,
);

export const ITEM_RE: RegExp = /^(plan|roadmap) (\d+) \(strategy: ([a-z-]+)\)$/;

/** Markdown around a closing line: bold, backticks, a quote marker. */
export const LEAD_MARKS_RE: RegExp = /^[\s`*_>]+/;
export const TRAIL_MARKS_RE: RegExp = /[\s`*_]+$/;
export const APPROVAL_RE: RegExp = /^([yh])(?:\s+(\S+))?$/i;

export const STAMP_DIR: readonly string[] = [".tmp", "repo", "sessions"];
export const STAMP_FILE = "strategy.json";
export const UNSAFE_SID_RE: RegExp = /[^\w-]/g;
export const FRONTMATTER_RE: RegExp = /^---\r?\n([\s\S]*?)\r?\n---/;
export const LINE_BREAK_RE: RegExp = /\r?\n/;
export const FM_LINE_RE: RegExp = /^([a-z]+):\s*(.*)$/;
export const IN_PROGRESS = "in-progress";
