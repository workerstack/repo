/** One closing line asks for approval; a bare `y` approves exactly what it names, and `h` hands it off. */
import fs from "node:fs";

import type { HookInput } from "./hook-input.ts";
import { orchestrateHandoff } from "./orchestrate-handoff.ts";
import {
  inProgressRoadmaps,
  isSliceOf,
  itemKey,
  queueText,
  readReviewsOpen,
  reviewState,
  reviewStateOf,
  reviewsOf,
} from "./orchestrate-reviews.ts";
import { approvalsFile, frontmatterOf, readLines } from "./orchestrate-session.ts";
import { resolveStamp, stampMtime } from "./orchestrate-stamps.ts";
import { closingLineOf, lastAssistantFromTranscript } from "./orchestrate-transcript.ts";
import { APPROVABLE_STATUS, APPROVAL_BLOCK_STAMP, LAST_INDEX, TURN_START_STAMP } from "./orchestrate.constants.ts";
import type {
  Approvable,
  ApprovalItem,
  KnownApproval,
  ReviewsOpen,
  Strategy,
  StrategyChange,
  StrategyWrite,
} from "./orchestrate.types.ts";
import { preparePlanUpdate } from "./persist-plan.ts";
import { prepareRoadmapUpdate } from "./persist-roadmap.ts";
import { isUnderPlans, isUnderRoadmaps } from "./persist-tmp.ts";
import { closingLine, parseApproval, parseStrategy, STRATEGIES } from "./strategy.ts";
import { resolveRoots } from "./workspace-root.ts";

/** What every saved item is judged against: the workspace, its running roadmaps and the open reviews. */
type Scan = { ws: string; running: string[]; open: ReviewsOpen };

function kindAt(abs: string, ws: string): Approvable["kind"] | null {
  if (isUnderPlans(abs, ws)) return "plan";
  return isUnderRoadmaps(abs, ws) ? "roadmap" : null;
}

function readItem(abs: string): { text: string; mtime: number } | null {
  try {
    return { mtime: fs.statSync(abs).mtimeMs, text: fs.readFileSync(abs, "utf8") };
  } catch {
    return null;
  }
}

/** The saved item at `abs` when it waits for a `y`; null when it is no settled, approvable plan or roadmap. */
function approvalItemAt(scan: Scan, abs: string): ApprovalItem | null {
  const kind = kindAt(abs, scan.ws);
  const read = kind ? readItem(abs) : null;
  if (!kind || !read) return null;
  const fm = frontmatterOf(read.text);
  const ref = { kind, serial: Number(fm.serial) };
  if (!APPROVABLE_STATUS[kind].has(fm.status ?? "") || reviewState(scan.open, ref, reviewsOf(fm)) !== "settled")
    return null;
  if (kind === "plan" && scan.running.some((t) => isSliceOf(abs, t))) return null;
  const strategy = parseStrategy(fm.strategy);
  return strategy ? { ...ref, mtime: read.mtime, path: abs, strategy } : null;
}

// Reviewed plans and roadmaps this session saved that still wait for a `y`, in first-save order.
function approvableItems(data: HookInput): ApprovalItem[] {
  const file = approvalsFile(data);
  if (!file) return [];
  const ws = resolveRoots(data).root;
  const scan: Scan = { open: readReviewsOpen(data), running: inProgressRoadmaps(ws), ws };
  return readLines(file).flatMap((abs) => approvalItemAt(scan, abs) ?? []);
}

/** True when the closing line names every pending item, and only known items with the strategy each file holds. */
function covers(named: Approvable[] | null, items: ApprovalItem[], pending: ApprovalItem[]): boolean {
  if (!named) return false;
  const known = new Set(items.map(itemKey));
  // The strategy a line shows must be the one the file holds, so a bare `y` never runs one the person did not see.
  const shownTruly = (n: Approvable): boolean =>
    items.some((i) => itemKey(i) === itemKey(n) && i.strategy === n.strategy);
  return (
    pending.every((p) => named.some((n) => itemKey(n) === itemKey(p))) &&
    named.every((n) => known.has(itemKey(n)) && shownTruly(n))
  );
}

// Stop reason when this turn saved a reviewed item and the reply does not end with a closing line covering it.
export function approvalBlockReason(data: HookInput, msg: string): string | null {
  if (!approvalsFile(data) || resolveStamp(data, APPROVAL_BLOCK_STAMP)) return null;
  const turnStart = stampMtime(data, TURN_START_STAMP);
  if (turnStart == null) return null;
  const items = approvableItems(data);
  const pending = items.filter((i) => i.mtime >= turnStart);
  if (!pending.length) return null;
  return covers(closingLineOf(msg), items, pending) ? null : `end with: ${closingLine(items)}`;
}

const runOf = (i: ApprovalItem): string =>
  i.kind === "plan"
    ? `run /implement-plan ${i.serial} (${i.path})`
    : `set status locked, then run /implement-roadmap ${i.serial} (${i.path})`;
const approveStep = (i: ApprovalItem): string => `${itemKey(i)}: ${runOf(i)}`;
const strategyStep = (i: ApprovalItem, strategy: Strategy): string =>
  `${itemKey(i)}: strategy ${strategy} was written to its frontmatter; re-read the ${i.kind}, then ${runOf(i)}`;

// The file's text with its `strategy:` frontmatter line set, validated through the persist module; null when nothing would change.
function strategyWrite(ws: string, item: ApprovalItem, strategy: Strategy): StrategyWrite {
  const previous = fs.readFileSync(item.path, "utf8");
  const m = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n)/.exec(previous);
  if (!m) return { error: "no frontmatter", ok: false };
  const next = m[0].replace(/^strategy:.*$/m, `strategy: ${strategy}`) + previous.slice(m[0].length);
  if (next === previous) return { content: null, ok: true };
  const prepare = item.kind === "plan" ? preparePlanUpdate : prepareRoadmapUpdate;
  const result = prepare({ content: next, filePath: item.path, workspaceRoot: ws });
  if (!result.ok) return { error: result.error, ok: false };
  return { content: result.content, ok: true };
}

/** The named items, each found among the approvable ones; null when one is missing or shows another strategy. */
function resolveNamed(data: HookInput, named: Approvable[], wanted: Strategy | null): ApprovalItem[] | null {
  const items = approvableItems(data);
  const resolved: ApprovalItem[] = [];
  for (const n of named) {
    const hit = items.find((i) => itemKey(i) === itemKey(n));
    if (!hit) return null;
    resolved.push(hit);
  }
  // A bare reply runs the strategy each file holds, so it must be the one the line showed.
  if (wanted === null && resolved.some((i, k) => i.strategy !== named[k]?.strategy)) return null;
  return resolved;
}

/** Each item's strategy change; the failure, as `kind N: why`, when one cannot be written. */
function planWrites(ws: string, resolved: ApprovalItem[], wanted: Strategy | null): StrategyChange[] | string {
  const writes: StrategyChange[] = [];
  for (const i of resolved) {
    const w: StrategyWrite = wanted === null ? { content: null, ok: true } : strategyWrite(ws, i, wanted);
    if (!w.ok) return `${itemKey(i)}: strategy ${wanted} could not be written (${w.error})`;
    writes.push({ content: w.content, item: i });
  }
  return writes;
}

/** Writes each changed file; the error text when one fails. */
function applyWrites(writes: StrategyChange[]): string | null {
  try {
    for (const w of writes) if (w.content !== null) fs.writeFileSync(w.item.path, w.content);
    return null;
  } catch (err) {
    return String(err);
  }
}

function settledReply(data: HookInput, reply: KnownApproval, named: Approvable[]): string {
  const refused = reply.kind === "handoff" ? "h did not hand off" : "y did not approve";
  const ws = resolveRoots(data).root;
  const open = readReviewsOpen(data);
  const unsettled = named.find((n) => {
    const state = reviewStateOf(ws, open, n);
    return state && state !== "settled";
  });
  if (unsettled)
    return `${refused} ${itemKey(unsettled)}: its review has not settled; wait for it, then end with the closing line again`;
  const wanted = reply.strategy;
  const resolved = resolveNamed(data, named, wanted);
  if (!resolved) return "";
  const writes = planWrites(ws, resolved, wanted);
  if (typeof writes === "string") return `${refused} ${writes}`;
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
  const steps = writes.map((w) =>
    w.content === null || wanted === null ? approveStep(w.item) : strategyStep(w.item, wanted),
  );
  return `y approves ${queueText(named)}: ${steps.join("; ")}`;
}

// Context for a reply of `y`, `y <strategy>`, `h`, `h fast` or `h deep` that answers the previous reply's closing line.
export function approvalContext(data: HookInput, prompt: string): string {
  const reply = parseApproval(prompt);
  const tp = data.transcript_path || data.transcriptPath;
  if (!reply || !tp) return "";
  const named = closingLineOf(lastAssistantFromTranscript(tp));
  if (!named) return "";
  if (reply.kind !== "unknown") return settledReply(data, reply, named);
  const choices = STRATEGIES.map((s) => `y ${s}`)
    .slice(0, LAST_INDEX)
    .join(", ");
  return `unknown strategy "${reply.word}"; use y, ${choices} or y ${STRATEGIES.at(LAST_INDEX)}`;
}
