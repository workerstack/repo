import { REPO, STATE } from "../repo-dirs.ts";
import type { ItemKind, ItemSpec } from "./orchestrate.types.ts";

/** Where the parent hook keeps its per-session stamps. */
export const ORCHESTRATOR_LOGS_DIR: string = `${REPO}/${STATE}/orchestrator-logs`;

/** The deny a write with no tool input gets. */
export const DENY_REASON = "denied";

/** The stamp holding this session's /ask or /away. */
export const SESSION_GATE_STAMP = "session-gate";

export const AWAY_STOP_REASON =
  'away: do not ask; decide, log "- decision: {question} → {choice}, because {why}" in the plan, and continue';

/** The stamps a turn counts or marks with. */
export const TURN_START_STAMP = "turn-start";
export const APPROVAL_BLOCK_STAMP = "approval-block";
export const STOP_BLOCK_STAMP = "stop-block";
export const PUSH_BLOCK_STAMP = "push-block";
export const NEED_INTERCEPT_STAMP = "need-intercept";

/** The items an /away Stop ran, as JSON `itemKey → mtimeMs` after its write, so a Stop runs each save once. */
export const AWAY_RUN_STAMP = "away-run";

export const AWAY_RUN_REASON =
  "away: ran the approval block's header choice and logged it in each file, so re-read each file before you edit it";

/** The session id stamps fall back to; it names no session of its own. */
export const NO_SESSION = "default";

/** The status of a running plan or roadmap. */
export const IN_PROGRESS = "in-progress";

/** The only stop reason a stop hook judges. */
export const END_TURN = "end_turn";

/** The whole reply that waits on a scout without asking. */
export const WAIT_SCOUT = "[orchestrator]: wait scout";

/** How much of a transcript's end is read for the last assistant reply. */
export const TRANSCRIPT_TAIL_BYTES: number = 512 * 1024;

/** Caps: need intercepts and ask/away stop blocks per turn, and jobs per need. */
export const MAX_INTERCEPT = 3;
export const MAX_STOP = 3;
export const MAX_NEED_JOBS = 4;

/** The receipt keeps this much of the reply's first line. */
export const RECEIPT_HEAD_CHARS = 200;

/** The index `at` reads the last element through. */
export const LAST_INDEX = -1;

/** A stamp count is read in base ten. */
export const DECIMAL = 10;

/** Tool names, by eventKey, that spawn an agent or write a file. */
export const SPAWN_TOOLS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "spawnsubagent",
  "task",
  "agent",
  "spawnagent",
]);

export const WRITE_TOOLS: ReadonlySet<string> = /* @__PURE__ */ new Set(["write", "edit", "searchreplace"]);

/** The need jobs a SubagentStop answers in place. */
export const INTERCEPT_JOBS: ReadonlySet<string> = /* @__PURE__ */ new Set(["search", "exec", "slice", "fetch"]);

/** Transcript record types and roles that are never the assistant's, and the one that is. */
export const NON_ASSISTANT_TYPES: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "user",
  "human",
  "tool",
  "tool_result",
]);

export const ASSISTANT = "assistant";

/** Content parts that carry a tool call or result, not reply text. */
export const TOOL_PARTS: ReadonlySet<string> = /* @__PURE__ */ new Set(["tool_use", "tool_result", "function_call"]);

/**
 * Everything that differs per item kind: the .repo dir it is saved in, the statuses at which it waits for an `i`,
 * whether a review must settle first, and the command a run or handoff names (`prefix` comes before it).
 */
export const ITEM_KINDS: Readonly<Record<ItemKind, ItemSpec>> = {
  "fast-plan": {
    approvable: /* @__PURE__ */ new Set(["ready"]),
    command: "/implement-plan-fast",
    dir: "plans-fast",
    needsReview: false,
    prefix: "",
  },
  "fast-roadmap": {
    approvable: /* @__PURE__ */ new Set(["draft", "locked"]),
    command: "/implement-roadmap-fast",
    dir: "roadmaps-fast",
    needsReview: false,
    prefix: "set status locked, then ",
  },
  plan: {
    approvable: /* @__PURE__ */ new Set(["ready"]),
    command: "/implement-plan-deep",
    dir: "plans",
    needsReview: true,
    prefix: "",
  },
  roadmap: {
    approvable: /* @__PURE__ */ new Set(["draft", "locked"]),
    command: "/implement-roadmap-deep",
    dir: "roadmaps",
    needsReview: true,
    prefix: "set status locked, then ",
  },
};

/** The kinds in the order a path is tried against their dirs. */
export const ITEM_KIND_LIST: readonly ItemKind[] = ["plan", "roadmap", "fast-plan", "fast-roadmap"];

/** The kind a `/review-plan N` or `/review-roadmap N` spawn names. */
export const PLAN_KIND = "plan";

/** The event key of a tool call about to run. */
export const PRE_TOOL_USE = "pretooluse";

/** The event keys whose answer always reads the agents defaults: a prompt and a Stop. */
export const DEFAULTS_EVENTS: ReadonlySet<string> = /* @__PURE__ */ new Set(["userpromptsubmit", "stop"]);
