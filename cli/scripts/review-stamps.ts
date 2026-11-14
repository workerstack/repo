/**
 * The session's review stamps: one file per spawn plan or fast plan the session saved, each pointing at its plan.
 * Each plan file is the truth; a stamp only points at it. Node builtins, `canonicalPath` and the stamp's schema only.
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
  IN_PROGRESS,
  LINE_BREAK_RE,
  PLAN_DIRS,
  REVIEWS_DIR,
  REVIEW_KIND_ORDER,
  STAMP_EXT,
  STAMP_STATUSES,
  UNSAFE_SID_RE,
} from "./strategy.constants.ts";
import { parseStrategy } from "./strategy.ts";
import type { ActiveReview, ReviewKind, SpawnStrategy } from "./strategy.types.ts";
import { canonicalPath } from "./workspace-root.ts";

/** The session's own dir under the state dir, with the sid cleaned so it stays inside `sessions/`. */
export function sessionDir(root: string, sid: string): string {
  return repoPath(root, STATE, "sessions", sid.replaceAll(UNSAFE_SID_RE, ""));
}

/** The kind of plan a path names: one under the fast plans folder is a fast plan. */
function reviewKindOf(planAbs: string): ReviewKind {
  return path.basename(path.dirname(planAbs)) === PLAN_DIRS["fast-plan"] ? "fast-plan" : "plan";
}

/** The plan's canonical path and the stamp file that points at it: `reviews/{kind}-{basename}.json`. */
function stampSite(root: string, sid: string, planAbs: string) {
  const plan = canonicalPath(path.resolve(planAbs));
  const name = `${reviewKindOf(plan)}-${path.basename(plan, path.extname(plan))}${STAMP_EXT}`;

  return { file: path.join(sessionDir(root, sid), REVIEWS_DIR, name), plan };
}

/**
 * Point the session at one more plan. Each plan has its own stamp file, so two saves never rewrite one shared file;
 * a temp file in the same directory, then a rename, so a reader never sees half a stamp.
 */
export function stampPlan(root: string, sid: string, planAbs: string): void {
  const { file, plan } = stampSite(root, sid, planAbs);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(tmp, `${JSON.stringify({ plan })}\n`);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Drop the session's stamp of one plan; nothing happens when there is none. */
export function unstampPlan(root: string, sid: string, planAbs: string): void {
  fs.rmSync(stampSite(root, sid, planAbs).file, { force: true });
}

/** Each stamp file of the session with the plan it names, or null when its body is not JSON naming one. */
function stampEntries(root: string, sid: string): { file: string; plan: string | null }[] {
  const dir = path.join(sessionDir(root, sid), REVIEWS_DIR);

  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => path.extname(f) === STAMP_EXT)
    .toSorted()
    .map((f) => {
      const file = path.join(dir, f);
      const body = tryJson(z.looseObject({ plan: z.string() }), fs.readFileSync(file, "utf8"));

      return { file, plan: body?.plan ?? null };
    });
}

/** The plans the session's stamps name, in stamp file order. */
export function stampedPlans(root: string, sid: string): string[] {
  return stampEntries(root, sid).flatMap((e) => (e.plan === null ? [] : [e.plan]));
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

/** A plan's spawn strategy and status, from its text, or null when it has no frontmatter or no spawn strategy. */
function spawnFrontmatter(text: string): { serial: number; status: string; strategy: SpawnStrategy } | null {
  const fm = frontmatter(text);
  const strategy = parseStrategy(fm?.strategy);

  if (fm === null || strategy === null || strategy === FREE_STRATEGY) return null;

  return { serial: Number(fm.serial), status: fm.status ?? "", strategy };
}

/** True when a plan's text keeps its stamp: a spawn strategy at ready or in-progress. */
export function keepsStamp(text: string): boolean {
  return STAMP_STATUSES.has(spawnFrontmatter(text)?.status ?? "");
}

/** A stamped plan's text, or null when the file cannot be read. */
function planTextOf(plan: string): string | null {
  try {
    return fs.readFileSync(plan, "utf8");
  } catch {
    return null;
  }
}

/** Remove every stamp whose plan no longer keeps it: done, blocked, free, no frontmatter, missing, or a bad body. */
export function pruneStamps(root: string, sid: string): void {
  for (const { file, plan } of stampEntries(root, sid)) {
    const text = plan === null ? null : planTextOf(plan);

    if (text === null || !keepsStamp(text)) fs.rmSync(file, { force: true });
  }
}

/** Plans before fast plans, each by serial. */
function reviewOrder(a: ActiveReview, b: ActiveReview): number {
  const byKind = REVIEW_KIND_ORDER[a.kind] - REVIEW_KIND_ORDER[b.kind];

  return byKind === 0 ? a.serial - b.serial : byKind;
}

/** The reviews this session runs: each stamped plan whose own frontmatter says in-progress and spawn-*. */
export function activeReviews(root: string, sid: string): ActiveReview[] {
  try {
    return stampedPlans(root, sid)
      .flatMap((plan): ActiveReview[] => {
        const text = planTextOf(plan);
        const fm = text === null ? null : spawnFrontmatter(text);

        if (fm?.status !== IN_PROGRESS) return [];

        return [{ kind: reviewKindOf(plan), plan, serial: fm.serial, strategy: fm.strategy }];
      })
      .toSorted(reviewOrder);
  } catch {
    return [];
  }
}
