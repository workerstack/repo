import type { parseApproval } from "./closing-line.ts";
import type { HookOutput, ToolArgs } from "./gate-harness.ts";
import type { HookInput } from "./hook-input.ts";
import type { STRATEGIES } from "./strategy.constants.ts";
import type { Approvable as BlockItem } from "./strategy.types.ts";
import type { Roots } from "./workspace-root.ts";

export type Strategy = (typeof STRATEGIES)[number];

/** A reviewed plan or roadmap, as the approval block names it. */
export type Approvable = BlockItem;

/** A plan or roadmap by kind and serial, never by path text. */
export type ItemRef = Pick<Approvable, "kind" | "serial">;

/** A reviewed item this session saved, with its file and when it was saved. */
export type ApprovalItem = {
  path: string;
  mtime: number;
} & Approvable;

/** A reply of `i` or `h`, with or without a strategy. */
export type KnownApproval = Exclude<NonNullable<ReturnType<typeof parseApproval>>, { kind: "unknown" }>;

/** Context the host adds for one event, blocking it when `decision` is set. */
export type ContextReply = {
  decision?: "block";
  hookSpecificOutput: { additionalContext: string; hookEventName: string };
};

/** Every reply a handler builds: the gate's deny or rewrite, a block with a reason, or added context. */
export type HostReply = HookOutput | { decision: "block"; reason: string } | ContextReply;

/** What a handler decides: the exit code and, when the host should see one, the one reply `main` writes. */
export type HookResult = {
  code: number;
  reply?: HostReply;
};

/** What every persist function answers to a full-content save. */
export type PersistOutcome = { ok: true; path: string; content: string } | { ok: false; error: string };

export type Persist = (args: { workspaceRoot: string; checkout: string; content: string }) => PersistOutcome;

/** A strategy rewrite of an item's file: the new text, or null when it already holds that strategy. */
export type StrategyWrite = { ok: true; content: string | null } | { ok: false; error: string };

export type StrategyChange = { item: ApprovalItem; content: string | null };

/** One handoff queue entry: the item, the strategy it runs and whether that was written to its file. */
export type HandoffEntry = { item: ApprovalItem; strategy: Strategy; written: boolean };

/**
 * A review's lifecycle, per item:
 *   unreviewed  no review spawn recorded and `reviews` is 0
 *   open        a review spawn recorded `reviews` at spawn, and the file's `reviews` is not above it yet
 *   settled     `reviews` is above the recorded number, or nothing was recorded and `reviews` is at least 1
 * Only a settled item may be named by an approval block, approved with `i`, or handed off with `h`.
 */
export type ReviewState = "unreviewed" | "open" | "settled";

/** The `reviews` each item held when its review was spawned, keyed `plan N` / `roadmap N`. */
export type ReviewsOpen = Record<string, number>;

/**
 * A write the parent hook classifies: the payload, its roots, the target as resolved and as canonical, and the
 * input.
 */
export type WriteCase = {
  data: HookInput;
  roots: Roots;
  rawPath: string;
  canon: string;
  toolInput: ToolArgs;
};
