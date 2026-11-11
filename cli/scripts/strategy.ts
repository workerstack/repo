/**
 * The strategy domain: how a plan or roadmap gets implemented, and the things that follow from it.
 *
 *   session stamp  which plan this session reviews; the plan file is the truth, the stamp only points at it
 *   mode           how a session handles a question: ask, auto or away
 *
 * The closing line and approval replies live in `closing-line.ts`. Node builtins and `canonicalPath` only.
 */
import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_STRATEGY,
  FM_LINE_RE,
  FRONTMATTER_RE,
  IMPLEMENTER_DEEP,
  IMPLEMENTER_FAST,
  IN_PROGRESS,
  LINE_BREAK_RE,
  MODES,
  REVIEW_FAST,
  STAMP_DIR,
  STAMP_FILE,
  STRATEGIES,
  UNSAFE_SID_RE,
} from "./strategy.constants.ts";
import type { ActiveReview, Mode, ReviewStrategy, Strategy } from "./strategy.types.ts";
import { canonicalPath } from "./workspace-root.ts";

export function parseMode(v: unknown): Mode | null {
  return MODES.find((m) => m === v) ?? null;
}

export function parseStrategy(v: unknown): Strategy | null {
  return STRATEGIES.find((s) => s === v) ?? null;
}

/** The implementer agent for a review strategy. review-fast starts fast and escalates; there is no attempt 3. */
export function implementerOf(s: ReviewStrategy, attempt: 1 | 2): typeof IMPLEMENTER_FAST | typeof IMPLEMENTER_DEEP {
  return s === REVIEW_FAST && attempt === 1 ? IMPLEMENTER_FAST : IMPLEMENTER_DEEP;
}

export function stampPath(root: string, sid: string): string {
  return path.join(root, ...STAMP_DIR, sid.replaceAll(UNSAFE_SID_RE, ""), STAMP_FILE);
}

/**
 * Point the session at a plan. Same content every time; a temp file in the same directory, then a rename,
 * so a reader never sees half a stamp.
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

/** The plan file the session's stamp points at, or null. Throws when the stamp is missing or not JSON. */
function stampedPlan(root: string, sid: string): string | null {
  const stamp: unknown = JSON.parse(fs.readFileSync(stampPath(root, sid), "utf8"));
  const plan = typeof stamp === "object" && stamp !== null && "plan" in stamp ? stamp.plan : null;
  return typeof plan === "string" ? plan : null;
}

/** The `key: value` lines of a file's frontmatter, or null when it has none. */
function frontmatter(text: string): Record<string, string> | null {
  const m = FRONTMATTER_RE.exec(text);
  if (m === null) return null;
  const fm: Record<string, string> = {};
  for (const line of (m[1] /* group 1 is not optional in the frontmatter regex */ as string).split(LINE_BREAK_RE)) {
    const kv = FM_LINE_RE.exec(line);
    if (kv === null) continue;
    const [, key, value] = [...kv] /* both groups always match */ as [string, string, string];
    fm[key] = value.trim();
  }
  return fm;
}

/** The review this session runs: the stamped plan, when its own frontmatter says in-progress and review-*. */
export function activeReview(root: string, sid: string): ActiveReview | null {
  try {
    const plan = stampedPlan(root, sid);
    const fm = plan === null ? null : frontmatter(fs.readFileSync(plan, "utf8"));
    if (plan === null || fm === null) return null;
    const strategy = parseStrategy(fm.strategy);
    if (fm.status !== IN_PROGRESS || strategy === null || strategy === DEFAULT_STRATEGY) return null;
    return { plan, serial: Number(fm.serial), strategy };
  } catch {
    return null;
  }
}
