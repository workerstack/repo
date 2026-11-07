/**
 * The strategy domain: how a plan or roadmap gets implemented, and the three things that follow from it.
 *
 *   closing line   the one line that asks for approval, rendered and parsed here and nowhere else
 *   approval       what a reply `y` or `y <strategy>` means
 *   session stamp  which plan this session reviews; the plan file is the truth, the stamp only points at it
 *
 * Node builtins and `canonicalPath` only.
 */
import fs from "node:fs";
import path from "node:path";
import { canonicalPath } from "./workspace-root.mjs";

/** @typedef {"default" | "review-fast" | "review-deep"} Strategy */
/** @typedef {Exclude<Strategy, "default">} ReviewStrategy */
/** @typedef {{ kind: "plan" | "roadmap", serial: number, strategy: Strategy }} Approvable */
/** @typedef {{ kind: "approve", strategy: Strategy | null } | { kind: "unknown", word: string }} Approval */
/** @typedef {{ plan: string, serial: number, strategy: ReviewStrategy }} ActiveReview */

/** @type {readonly Strategy[]} */
export const STRATEGIES = ["default", "review-fast", "review-deep"];

/**
 * Harnesses whose child and parent payloads differ by a marker the gate reads, so the review deny is enforced.
 * Phase 6 probe (live, 2026-11-07):
 *   claude  child has agent_id and agent_type; Grok's wire shape is Claude's (`harnessOf` says claude), and its child
 *           has subagentType, so "claude" covers Grok too
 *   codex   child has agent_id and agent_type
 *   antigravity, cursor  a child carries no marker; it only has a different session id. Not enforced.
 * @type {ReadonlySet<"claude" | "codex" | "antigravity" | "cursor">}
 */
export const ENFORCED_HARNESSES = new Set(["claude", "codex"]);

/** @param {unknown} v @returns {Strategy | null} */
export function parseStrategy(v) {
  return typeof v === "string" && STRATEGIES.includes(/** @type {Strategy} */ (v)) ? /** @type {Strategy} */ (v) : null;
}

/**
 * The implementer agent for a review strategy. review-fast starts fast and escalates; there is no attempt 3.
 * @param {ReviewStrategy} s
 * @param {1 | 2} attempt
 * @returns {"implementer-fast" | "implementer-deep"}
 */
export function implementerOf(s, attempt) {
  return s === "review-fast" && attempt === 1 ? "implementer-fast" : "implementer-deep";
}

const itemText = (/** @type {Approvable} */ i) => `${i.kind} ${i.serial} (strategy: ${i.strategy})`;

/**
 * The only renderer of the approval line. The `or` list holds every strategy not held by all items.
 * @param {Approvable[]} items
 */
export function closingLine(items) {
  if (!items.length) throw new Error("closingLine needs at least one item");
  const others = STRATEGIES.filter((s) => !items.every((i) => i.strategy === s));
  return `Reply "y" to run ${items.map(itemText).join(", then ")}, or ${others.map((s) => `"y ${s}"`).join(" / ")}.`;
}

const CLOSING_RE = /^Reply "y" to run ((?:plan|roadmap) \d+ \(strategy: [a-z-]+\)(?:, then (?:plan|roadmap) \d+ \(strategy: [a-z-]+\))*), or /;
const ITEM_RE = /^(plan|roadmap) (\d+) \(strategy: ([a-z-]+)\)$/;

/**
 * The items a closing line names, or null unless the line is exactly what `closingLine` renders for them.
 * Markdown around the line (bold, backticks, a quote marker) is ignored.
 * @param {string} line
 * @returns {Approvable[] | null}
 */
export function parseClosingLine(line) {
  const text = String(line ?? "").replace(/^[\s`*_>]+/, "").replace(/[\s`*_]+$/, "");
  const m = CLOSING_RE.exec(text);
  if (!m) return null;
  /** @type {Approvable[]} */
  const items = [];
  for (const part of m[1].split(", then ")) {
    const it = ITEM_RE.exec(part);
    const strategy = it && parseStrategy(it[3]);
    if (!it || !strategy) return null;
    items.push({ kind: /** @type {"plan" | "roadmap"} */ (it[1]), serial: Number(it[2]), strategy });
  }
  return closingLine(items) === text ? items : null;
}

/**
 * A reply of `y` (keep each file's strategy) or `y <word>`. Null when the prompt is not a y reply.
 * @param {string} prompt
 * @returns {Approval | null}
 */
export function parseApproval(prompt) {
  const m = /^y(?:\s+(\S+))?$/i.exec(String(prompt ?? "").trim());
  if (!m) return null;
  if (m[1] === undefined) return { kind: "approve", strategy: null };
  const strategy = parseStrategy(m[1].toLowerCase());
  return strategy ? { kind: "approve", strategy } : { kind: "unknown", word: m[1] };
}

/** @param {string} root @param {string} sid */
export function stampPath(root, sid) {
  return path.join(root, ".tmp", "repo", "sessions", String(sid).replace(/[^\w-]/g, ""), "strategy.json");
}

/**
 * Point the session at a plan. Same content every time; a temp file in the same directory, then a rename,
 * so a reader never sees half a stamp.
 * @param {string} root @param {string} sid @param {string} planAbs
 */
export function writeStamp(root, sid, planAbs) {
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
 * @param {string} root @param {string} sid
 * @returns {ActiveReview | null}
 */
export function activeReview(root, sid) {
  try {
    const stamp = JSON.parse(fs.readFileSync(stampPath(root, sid), "utf8"));
    if (!stamp || typeof stamp.plan !== "string") return null;
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(stamp.plan, "utf8"));
    if (!m) return null;
    /** @type {Record<string, string>} */
    const fm = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([a-z]+):\s*(.*)$/.exec(line);
      if (kv) fm[kv[1]] = kv[2].trim();
    }
    const strategy = parseStrategy(fm.strategy);
    if (fm.status !== "in-progress" || !strategy || strategy === "default") return null;
    return { plan: stamp.plan, serial: Number(fm.serial), strategy };
  } catch {
    return null;
  }
}
