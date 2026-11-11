/**
 * The strategy domain: how a plan or roadmap gets implemented, and the things that follow from it.
 *
 *   closing line   the one line that asks for approval or a handoff, rendered and parsed here and nowhere else
 *   approval       what a reply `y`, `y <strategy>`, `h`, `h fast` or `h deep` means
 *   session stamp  which plan this session reviews; the plan file is the truth, the stamp only points at it
 *   mode           how a session handles a question: ask, auto or away
 *
 * Node builtins and `canonicalPath` only.
 */
import fs from "node:fs";
import path from "node:path";

import { canonicalPath } from "./workspace-root.ts";

type Strategy = "default" | "review-fast" | "review-deep";
type ReviewStrategy = Exclude<Strategy, "default">;
type Approvable = { kind: "plan" | "roadmap"; serial: number; strategy: Strategy };
type Approval =
  | { kind: "approve"; strategy: Strategy | null }
  | { kind: "handoff"; strategy: Strategy | null }
  | { kind: "unknown"; word: string };
export type ActiveReview = { plan: string; serial: number; strategy: ReviewStrategy };

export const STRATEGIES: readonly Strategy[] = ["default", "review-fast", "review-deep"];

export const MODES = ["ask", "auto", "away"] as const;
export type Mode = (typeof MODES)[number];

/** @param v @returns */
export function parseMode(v: unknown): Mode | null {
  return MODES.find((m) => m === v) ?? null;
}

/**
 * Harnesses whose child and parent payloads differ by a marker the gate reads, so the review deny is enforced.
 * Phase 6 probe (live, 2026-11-07):
 *   claude  child has agent_id and agent_type; Grok's wire shape is Claude's (`harnessOf` says claude), and its child
 *           has subagentType, so "claude" covers Grok too
 *   codex   child has agent_id and agent_type
 *   antigravity, cursor  a child carries no marker; it only has a different session id. Not enforced.
 */
export const ENFORCED_HARNESSES: ReadonlySet<"claude" | "codex" | "antigravity" | "cursor"> = new Set<
  "claude" | "codex" | "antigravity" | "cursor"
>(["claude", "codex"]);

/** @param v @returns */
export function parseStrategy(v: unknown): Strategy | null {
  return STRATEGIES.find((s) => s === v) ?? null;
}

/**
 * The implementer agent for a review strategy. review-fast starts fast and escalates; there is no attempt 3.
 * @param s
 * @param attempt
 * @returns
 */
export function implementerOf(s: ReviewStrategy, attempt: 1 | 2): "implementer-fast" | "implementer-deep" {
  return s === "review-fast" && attempt === 1 ? "implementer-fast" : "implementer-deep";
}

const itemText = (i: Approvable) => `${i.kind} ${i.serial} (strategy: ${i.strategy})`;

const HANDOFFS = '"h" / "h fast" / "h deep" for a fresh session';
const handoffStrategy = (w: string): Strategy | null =>
  w === "fast" ? "review-fast" : w === "deep" ? "review-deep" : null;

/**
 * The only renderer of the approval line. The first `or` list holds every strategy not held by all items;
 * the second offers a handoff to a fresh session.
 * @param items
 */
export function closingLine(items: Approvable[]) {
  if (!items.length) throw new Error("closingLine needs at least one item");
  const others = STRATEGIES.filter((s) => !items.every((i) => i.strategy === s));
  return `Reply "y" to run ${items.map(itemText).join(", then ")}, or ${others.map((s) => `"y ${s}"`).join(" / ")}, or ${HANDOFFS}.`;
}

const CLOSING_RE =
  /^Reply "y" to run ((?:plan|roadmap) \d+ \(strategy: [a-z-]+\)(?:, then (?:plan|roadmap) \d+ \(strategy: [a-z-]+\))*), or /;
const ITEM_RE = /^(plan|roadmap) (\d+) \(strategy: ([a-z-]+)\)$/;

/**
 * The items a closing line names, or null unless the line is exactly what `closingLine` renders for them.
 * Markdown around the line (bold, backticks, a quote marker) is ignored.
 * @param line
 * @returns
 */
export function parseClosingLine(line: string): Approvable[] | null {
  const text = String(line)
    .replace(/^[\s`*_>]+/, "")
    .replace(/[\s`*_]+$/, "");
  const m = CLOSING_RE.exec(text);
  if (!m) return null;
  const items: Approvable[] = [];
  for (const part of (m[1] /* group 1 is not optional in CLOSING_RE */ as string).split(", then ")) {
    const it = ITEM_RE.exec(part);
    const kind = it?.[1];
    const strategy = parseStrategy(it?.[3]);
    if (!it || (kind !== "plan" && kind !== "roadmap") || !strategy) return null;
    items.push({ kind, serial: Number(it[2]), strategy });
  }
  return closingLine(items) === text ? items : null;
}

/**
 * A reply of `y` (keep each file's strategy) or `y <strategy>`, or a handoff `h` (keep) or `h fast` / `h deep`.
 * Null when the prompt is neither a y nor an h reply.
 * @param prompt
 * @returns
 */
export function parseApproval(prompt: string): Approval | null {
  const m = /^([yh])(?:\s+(\S+))?$/i.exec(String(prompt).trim());
  if (!m) return null;
  const kind = m[1]?.toLowerCase() === "h" ? "handoff" : "approve";
  const word = m[2];
  if (word === undefined) return { kind, strategy: null };
  const strategy = kind === "handoff" ? handoffStrategy(word.toLowerCase()) : parseStrategy(word.toLowerCase());
  return strategy ? { kind, strategy } : { kind: "unknown", word };
}

/** @param root @param sid */
export function stampPath(root: string, sid: string): string {
  return path.join(root, ".tmp", "repo", "sessions", String(sid).replace(/[^\w-]/g, ""), "strategy.json");
}

/**
 * Point the session at a plan. Same content every time; a temp file in the same directory, then a rename,
 * so a reader never sees half a stamp.
 * @param root @param sid @param planAbs
 */
export function writeStamp(root: string, sid: string, planAbs: string): void {
  const dest = stampPath(root, sid);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify({ plan: canonicalPath(path.resolve(planAbs)) })}\n`);
    fs.renameSync(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * The review this session runs: the stamped plan, when its own frontmatter says in-progress and review-*.
 * @param root @param sid
 * @returns
 */
export function activeReview(root: string, sid: string): ActiveReview | null {
  try {
    const stamp = JSON.parse(fs.readFileSync(stampPath(root, sid), "utf8"));
    const plan = typeof stamp === "object" && stamp !== null && "plan" in stamp ? stamp.plan : null;
    if (typeof plan !== "string") return null;
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(plan, "utf8"));
    if (!m) return null;
    const fm: Record<string, string> = {};
    for (const line of (m[1] /* group 1 is not optional in the frontmatter regex */ as string).split(/\r?\n/)) {
      const kv = /^([a-z]+):\s*(.*)$/.exec(line);
      if (kv)
        fm[kv[1] /* both groups always match */ as string] = (kv[2] /* both groups always match */ as string).trim();
    }
    const strategy = parseStrategy(fm.strategy);
    if (fm.status !== "in-progress" || !strategy || strategy === "default") return null;
    return { plan, serial: Number(fm.serial), strategy };
  } catch {
    return null;
  }
}
