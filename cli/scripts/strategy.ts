/**
 * The strategy domain: how a plan or roadmap gets implemented, and the things that follow from it.
 *
 *   session stamp  which plan this session reviews; the plan file is the truth, the stamp only points at it
 *   mode           how a session handles a question: ask or away
 *
 * The approval block and approval replies live in `closing-line.ts`. Node builtins, `canonicalPath` and the stamp's
 * schema only.
 */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import { STATE, repoPath } from "../repo-dirs.ts";
import {
  FREE_STRATEGY,
  FM_LINE_RE,
  FRONTMATTER_RE,
  IMPLEMENTER_DEEP,
  IMPLEMENTER_FAST,
  IN_PROGRESS,
  LINE_BREAK_RE,
  MODES,
  SPAWN_FAST,
  STAMP_FILE,
  STRATEGIES,
  UNSAFE_SID_RE,
} from "./strategy.constants.ts";
import type { ActiveReview, Approvable, ItemKind, Mode, SpawnStrategy, Strategy } from "./strategy.types.ts";
import { canonicalPath } from "./workspace-root.ts";

/** True for a kind that has a strategy: a full plan or roadmap. A fast plan or fast roadmap has none. */
export function kindHasStrategy(kind: ItemKind): kind is "plan" | "roadmap" {
  return kind === "plan" || kind === "roadmap";
}

/** True for an item that has a strategy; the one guard every caller uses instead of testing a kind. */
export function hasStrategy<T extends Approvable>(item: T): item is Extract<T, { strategy: Strategy }> {
  return kindHasStrategy(item.kind);
}

export function parseMode(v: string | undefined): Mode | null {
  return MODES.find((m) => m === v) ?? null;
}

export function parseStrategy(v: string | undefined): Strategy | null {
  return STRATEGIES.find((s) => s === v) ?? null;
}

/** The implementer agent for a spawn strategy. spawn-fast starts fast and escalates; there is no attempt 3. */
export function implementerOf(s: SpawnStrategy, attempt: 1 | 2): typeof IMPLEMENTER_FAST | typeof IMPLEMENTER_DEEP {
  return s === SPAWN_FAST && attempt === 1 ? IMPLEMENTER_FAST : IMPLEMENTER_DEEP;
}

export function stampPath(root: string, sid: string): string {
  return repoPath(root, STATE, "sessions", sid.replaceAll(UNSAFE_SID_RE, ""), STAMP_FILE);
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

/** The plan file the session's stamp points at, or null when it is not JSON naming one. Throws when it is missing. */
function stampedPlan(root: string, sid: string): string | null {
  return tryJson(z.looseObject({ plan: z.string() }), fs.readFileSync(stampPath(root, sid), "utf8"))?.plan ?? null;
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

/** The review this session runs: the stamped plan, when its own frontmatter says in-progress and spawn-*. */
export function activeReview(root: string, sid: string): ActiveReview | null {
  try {
    const plan = stampedPlan(root, sid);
    const fm = plan === null ? null : frontmatter(fs.readFileSync(plan, "utf8"));

    if (plan === null || fm === null) return null;
    const strategy = parseStrategy(fm.strategy);

    if (fm.status !== IN_PROGRESS || strategy === null || strategy === FREE_STRATEGY) return null;

    return { plan, serial: Number(fm.serial), strategy };
  } catch {
    return null;
  }
}
