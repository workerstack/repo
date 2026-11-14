/**
 * One approval block asks for approval; a bare `i` approves exactly what it names, `i` with a strategy word writes that
 * strategy first, and `h` hands it off.
 */
import fs from "node:fs";

import type { AgentDefaults } from "../config-resolved.types.ts";
import { pickerInput } from "./approval-picker.ts";
import { closingBlock, notAChoice, parseApprovalReply, parseClosingBlock } from "./closing-line.ts";
import { firstNonEmpty } from "./first-non-empty.ts";
import type { HookInput } from "./hook-input.ts";
import { orchestrateHandoff } from "./orchestrate-handoff.ts";
import {
  inProgressRoadmaps,
  isSliceOf,
  itemKey,
  kindAt,
  queueText,
  readReviewsOpen,
  reviewState,
  reviewStateOf,
  reviewsOf,
  type RunningRoadmap,
} from "./orchestrate-reviews.ts";
import { approvalsFile, frontmatterOf, readLines } from "./orchestrate-session.ts";
import { resolveStamp, stampMtime } from "./orchestrate-stamps.ts";
import { applyWrites, planWrites } from "./orchestrate-strategy-writes.ts";
import { lastAssistantFromTranscript } from "./orchestrate-transcript.ts";
import { APPROVAL_BLOCK_STAMP, ITEM_KINDS, TURN_START_STAMP } from "./orchestrate.constants.ts";
import type {
  Approvable,
  ApprovalItem,
  ItemKind,
  ItemRef,
  KnownApproval,
  ReviewsOpen,
  Strategy,
  StrategyChange,
} from "./orchestrate.types.ts";
import { setSessionStrategy } from "./session-settings.ts";
import { PICKER_LINE } from "./strategy.constants.ts";
import { parseStrategy } from "./strategy.ts";
import { resolveRoots } from "./workspace-root.ts";

/** What every saved item is judged against: the workspace, its running roadmaps and the open reviews. */
type Scan = { ws: string; running: RunningRoadmap[]; open: ReviewsOpen };

/** The kind of roadmap whose slices a kind of plan can be. */
const SLICE_OF: Readonly<Partial<Record<ItemKind, RunningRoadmap["kind"]>>> = {
  "fast-plan": "fast-roadmap",
  plan: "roadmap",
};

const WAIT_THEN_CLOSE = "wait for it, then end with the approval block again";

function readItem(abs: string): { text: string; mtime: number } | null {
  try {
    return { mtime: fs.statSync(abs).mtimeMs, text: fs.readFileSync(abs, "utf8") };
  } catch {
    return null;
  }
}

/**
 * True when the saved item is at a status that waits for an `i`, settled, and no slice of a running roadmap of its
 * own kind: a plan is skipped only by a full roadmap, a fast plan only by a fast roadmap.
 */
function waitsForI(scan: Scan, abs: string, saved: { ref: ItemRef; fm: Record<string, string> }): boolean {
  const { ref, fm } = saved;

  if (!ITEM_KINDS[ref.kind].approvable.has(fm.status ?? "")) return false;

  if (reviewState(scan.open, ref, reviewsOf(fm)) !== "settled") return false;

  const owner = SLICE_OF[ref.kind];

  return !scan.running.some((r) => r.kind === owner && isSliceOf(abs, r.text));
}

/**
 * The item a ref names with the strategy and advice its file holds; null when the strategy is none. A file with no
 * `advice:` has none (null).
 */
function itemOf(ref: ItemRef, at: { path: string; mtime: number }, fm: Record<string, string>): ApprovalItem | null {
  const strategy = parseStrategy(fm.strategy);
  const advice = fm.advice === undefined || fm.advice === "" ? null : fm.advice;

  return strategy === null ? null : { ...at, advice, kind: ref.kind, serial: ref.serial, strategy };
}

/** The saved item at `abs` when it waits for an `i`; null when it is not settled and approvable. */
function approvalItemAt(scan: Scan, abs: string): ApprovalItem | null {
  const kind = kindAt(abs, scan.ws);
  const read = kind === null ? null : readItem(abs);

  if (kind === null || read === null) return null;
  const fm = frontmatterOf(read.text);
  const ref = { kind, serial: Number(fm.serial) };

  return waitsForI(scan, abs, { fm, ref }) ? itemOf(ref, { mtime: read.mtime, path: abs }, fm) : null;
}

// Reviewed plans and roadmaps this session saved that still wait for an `i`, in first-save order.
export function approvableItems(data: HookInput): ApprovalItem[] {
  const file = approvalsFile(data);

  if (file === null) return [];
  const ws = resolveRoots(data).root;
  const scan: Scan = { open: readReviewsOpen(data), running: inProgressRoadmaps(ws), ws };

  return readLines(file).flatMap((abs) => approvalItemAt(scan, abs) ?? []);
}

/**
 * True when the approval block names every pending item, and only known items with the strategy and advice each file
 * holds.
 */
function covers(named: Approvable[] | null, items: ApprovalItem[], pending: ApprovalItem[]): boolean {
  if (named === null) return false;
  const known = new Set(items.map(itemKey));

  // The strategy and advice a block shows must be the file's, so a bare `i` never runs one the person did not see.
  function shownTruly(n: Approvable): boolean {
    return items.some((i) => itemKey(i) === itemKey(n) && i.strategy === n.strategy && i.advice === n.advice);
  }

  return (
    pending.every((p) => named.some((n) => itemKey(n) === itemKey(p))) &&
    named.every((n) => known.has(itemKey(n)) && shownTruly(n))
  );
}

/**
 * Stop reason when this turn saved a reviewed item and the reply does not end with an approval block covering it;
 * with `picker` it leads with the picker the session is asked to call.
 */
export function approvalBlockReason(data: HookInput, msg: string, opts: { picker: boolean }): string | null {
  if (approvalsFile(data) === null || resolveStamp(data, APPROVAL_BLOCK_STAMP) !== null) return null;
  const turnStart = stampMtime(data, TURN_START_STAMP);

  if (turnStart == null) return null;
  const items = approvableItems(data);
  const pending = items.filter((i) => i.mtime >= turnStart);

  if (pending.length === 0) return null;

  // A picker is asked for even when the reply already ends with the block; the stamp keeps it to once a turn.
  if (opts.picker) return `${PICKER_LINE}\n${JSON.stringify(pickerInput(items))}\n${closingBlock(items)}`;

  return covers(parseClosingBlock(msg), items, pending) ? null : `end with this block:\n${closingBlock(items)}`;
}

function runOf(i: ApprovalItem): string {
  const spec = ITEM_KINDS[i.kind];

  return `${spec.prefix}run ${spec.command} ${i.serial} (${i.path})`;
}

function approveStep(i: ApprovalItem): string {
  return `${itemKey(i)}: ${runOf(i)}`;
}

/** What a bare `i` says for `items`: the queue, then each item's step, by default its run. */
export function approvedText(items: ApprovalItem[], step: (i: ApprovalItem) => string = approveStep): string {
  return `i approves ${queueText(items)}: ${items.map(step).join("; ")}`;
}

function strategyStep(i: ApprovalItem, strategy: Strategy): string {
  return `${itemKey(i)}: strategy ${strategy} was written to its frontmatter; re-read the ${i.kind}, then ${runOf(i)}`;
}

/** The named items, each found among the approvable ones; null when one is missing or shows another strategy. */
function resolveNamed(data: HookInput, named: Approvable[], wanted: Strategy | null): ApprovalItem[] | null {
  const items = approvableItems(data);
  const resolved: ApprovalItem[] = [];

  for (const n of named) {
    const hit = items.find((i) => itemKey(i) === itemKey(n));

    // A bare reply runs the strategy each file holds, so it must be the one the block showed.
    if (hit === undefined || (wanted === null && hit.strategy !== n.strategy)) return null;
    resolved.push(hit);
  }

  return resolved;
}

/** The first named item whose review has not settled; undefined when every one has or names no file. */
function firstUnsettled(ws: string, open: ReviewsOpen, named: Approvable[]): Approvable | undefined {
  return named.find((n) => {
    const state = reviewStateOf(ws, open, n);

    return state !== null && state !== "settled";
  });
}

/** The writes an approval made and the strategy word it carried, if any. */
type Done = { writes: StrategyChange[]; wanted: Strategy | null };

/** What an approving `i` says once its writes are done; with a strategy word it also sets the session strategy. */
function approvedWith(data: HookInput, defaults: AgentDefaults, done: Done): string {
  const { wanted, writes } = done;
  const written = new Set(writes.flatMap((w) => (w.content === null ? [] : [w.item])));

  const text = approvedText(
    writes.map((w) => w.item),
    (i) => (wanted === null || !written.has(i) ? approveStep(i) : strategyStep(i, wanted)),
  );

  return wanted === null ? text : [text, setSessionStrategy(data, defaults, wanted)].filter(Boolean).join("\n");
}

/** The one approval path: a typed reply and a click both settle through it, so a refusal and a write read the same. */
export function settledReply(
  data: HookInput,
  answer: { reply: KnownApproval; named: Approvable[] },
  defaults: AgentDefaults,
): string {
  const { named, reply } = answer;
  const refused = reply.kind === "handoff" ? "h did not hand off" : "i did not approve";
  const ws = resolveRoots(data).root;
  const unsettled = firstUnsettled(ws, readReviewsOpen(data), named);

  if (unsettled !== undefined)
    return `${refused} ${itemKey(unsettled)}: its review has not settled; ${WAIT_THEN_CLOSE}`;
  const wanted = reply.strategy;
  const resolved = resolveNamed(data, named, wanted);

  if (resolved === null) return "";
  const planned = planWrites(ws, resolved, wanted);

  if (!planned.ok) return `${refused} ${planned.error}`;
  const writes = planned.value;
  const failed = applyWrites(writes);

  if (failed !== null) return `${refused} ${queueText(named)}: strategy ${wanted} could not be written (${failed})`;

  if (reply.kind === "handoff") {
    const queue = writes.map((w) => ({
      item: w.item,
      strategy: wanted ?? w.item.strategy,
      written: w.content !== null,
    }));

    return orchestrateHandoff(data, ws, queue);
  }

  return approvedWith(data, defaults, { wanted, writes });
}

/**
 * Context for a reply of `i` or `h`, alone or with a strategy word, or a spelled-out choice, that answers the
 * previous reply's approval block. A retired letter code is no choice. An approving `i` with a strategy word that
 * wrote its files also sets the session strategy; a handoff, a refusal and a failed write leave the session alone.
 */
export function approvalContext(data: HookInput, prompt: string, defaults: AgentDefaults): string {
  const tp = firstNonEmpty(data.transcript_path, data.transcriptPath);

  if (tp === undefined) return "";
  const named = parseClosingBlock(lastAssistantFromTranscript(tp));

  if (named === null) return "";
  const reply = parseApprovalReply(prompt);

  if (reply === null) return "";

  return reply.kind === "unknown" ? notAChoice(reply.word, named) : settledReply(data, { named, reply }, defaults);
}
