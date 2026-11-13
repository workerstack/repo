/** Each plan's and roadmap's review state, from its `reviews` and the review spawns this session recorded. */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { isString, tryJson } from "../json.ts";
import { repoPath } from "../repo-dirs.ts";
import type { ToolArgs } from "./gate-harness.ts";
import type { HookInput } from "./hook-input.ts";
import { frontmatterOf, sessionFile } from "./orchestrate-session.ts";
import { IN_PROGRESS, ITEM_KINDS, ITEM_KIND_LIST, PLAN_KIND } from "./orchestrate.constants.ts";
import type { Approvable, ItemKind, ItemRef, ReviewState, ReviewsOpen, Strategy } from "./orchestrate.types.ts";
import { isUnderRepoDir } from "./persist-tmp.ts";
import { hasStrategy } from "./strategy.ts";
import { resolveRoots } from "./workspace-root.ts";

const REVIEW_SPAWN_RE = /^\s*\/review-(plan|roadmap)\s+(\d+)(?!\S)/;
const LOCATION_LINE = /^\s*Location:\s*(.+?)\s*$/gm;
const SETTLE_THEN_CLOSE = "settle its findings with reviews bumped, then end with the approval block";

export function itemKey(item: ItemRef): string {
  return `${item.kind} ${item.serial}`;
}

/** The kind whose dir holds `abs`; null for a path no item kind owns. */
export function kindAt(abs: string, ws: string): ItemKind | null {
  return ITEM_KIND_LIST.find((kind) => isUnderRepoDir(abs, ws, ITEM_KINDS[kind].dir)) ?? null;
}

/** The strategy an item runs; null for a fast plan or fast roadmap, which have none. */
export function itemStrategy(item: Approvable): Strategy | null {
  return hasStrategy(item) ? item.strategy : null;
}

export function queueText(items: Approvable[]): string {
  return items.map(itemKey).join(", then ");
}

export function reviewsOf(fm: Record<string, string>): number {
  const reviews = Number(fm.reviews);

  return Number.isNaN(reviews) ? 0 : reviews;
}

function reviewsOpenFile(data: HookInput): string | null {
  return sessionFile(data, "reviews-open.json");
}

// True when a roadmap slice's Location names this plan; Windows paths compare case-insensitively.
export function isSliceOf(planPath: string, roadmapText: string, impl: typeof path = path): boolean {
  function norm(p: string): string {
    const n = impl.normalize(impl.resolve(p));

    return impl === path.win32 ? n.toLowerCase() : n;
  }

  const target = norm(planPath);

  for (const [, location] of roadmapText.matchAll(LOCATION_LINE))
    if (norm(location /* the Location group always participates in a match */ as string) === target) return true;

  return false;
}

/** A running roadmap's text, with the kind of roadmap it is. */
export type RunningRoadmap = { kind: "roadmap" | "fast-roadmap"; text: string };

const ROADMAP_KINDS = ["roadmap", "fast-roadmap"] as const;

function runningIn(ws: string, kind: RunningRoadmap["kind"]): RunningRoadmap[] {
  const dir = repoPath(ws, ITEM_KINDS[kind].dir);
  let names: string[] = [];

  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".md"));
  } catch {
    return [];
  }

  const running: RunningRoadmap[] = [];

  for (const name of names) {
    try {
      const text = fs.readFileSync(path.join(dir, name), "utf8");

      if (frontmatterOf(text).status === IN_PROGRESS) running.push({ kind, text });
    } catch {
      // skip unreadable
    }
  }

  return running;
}

/** Each in-progress roadmap and fast roadmap in the workspace, with its kind. */
export function inProgressRoadmaps(ws: string): RunningRoadmap[] {
  return ROADMAP_KINDS.flatMap((kind) => runningIn(ws, kind));
}

function counted(entry: [string, number | null]): entry is [string, number] {
  return entry[1] !== null;
}

/** The open review counts by item; an entry that is not a number is dropped. */
function reviewsOpenSchema() {
  return z
    .record(z.string(), z.number().nullable().catch(null))
    .transform((open): ReviewsOpen => Object.fromEntries(Object.entries(open).filter(counted)));
}

export function readReviewsOpen(data: HookInput): ReviewsOpen {
  const file = reviewsOpenFile(data);

  if (file === null) return {};

  try {
    return tryJson(reviewsOpenSchema(), fs.readFileSync(file, "utf8")) ?? {};
  } catch {
    return {};
  }
}

function serialAt(abs: string): number {
  return Number(frontmatterOf(fs.readFileSync(abs, "utf8")).serial);
}

/** True when `abs` reads as holding `serial`; an unreadable file holds none. */
function holdsSerial(abs: string, serial: number): boolean {
  let isHeld = false;

  try {
    isHeld = serialAt(abs) === serial;
  } catch {
    // An unreadable file holds none.
  }

  return isHeld;
}

// The saved file for a plan or roadmap serial, found through its directory; null when none holds that serial.
function itemFile(ws: string, ref: ItemRef): string | null {
  const dir = repoPath(ws, ITEM_KINDS[ref.kind].dir);
  let names: string[];

  try {
    names = fs.readdirSync(dir).filter((n) => n.startsWith(`${ref.serial}-`) && n.endsWith(".md"));
  } catch {
    return null;
  }

  const abs = names.map((name) => path.join(dir, name)).find((file) => holdsSerial(file, ref.serial));

  return abs ?? null;
}

export function reviewState(open: ReviewsOpen, ref: ItemRef, reviews: number): ReviewState {
  if (!ITEM_KINDS[ref.kind].needsReview) return "settled";
  const atSpawn = open[itemKey(ref)];

  if (atSpawn !== undefined) return reviews > atSpawn ? "settled" : "open";

  return reviews >= 1 ? "settled" : "unreviewed";
}

// The review state of the file a ref names; null when no file holds it.
export function reviewStateOf(ws: string, open: ReviewsOpen, ref: ItemRef): ReviewState | null {
  const file = itemFile(ws, ref);

  if (file === null) return null;

  return reviewState(open, ref, reviewsOf(frontmatterOf(fs.readFileSync(file, "utf8"))));
}

// A spawn whose prompt starts `/review-plan N` or `/review-roadmap N` records the item's `reviews` at spawn.
export function recordReviewSpawn(data: HookInput, toolInput: ToolArgs | undefined): void {
  try {
    const prompt = toolInput?.prompt;
    const [, kind, serial] = REVIEW_SPAWN_RE.exec(isString(prompt) ? prompt : "") ?? [];
    const file = reviewsOpenFile(data);

    if (kind === undefined || file === null) return;
    const ref: ItemRef = { kind: kind === PLAN_KIND ? "plan" : "roadmap", serial: Number(serial) };
    const abs = itemFile(resolveRoots(data).root, ref);

    if (abs === null) return;
    const reviews = reviewsOf(frontmatterOf(fs.readFileSync(abs, "utf8")));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...readReviewsOpen(data), [itemKey(ref)]: reviews }));
    fs.renameSync(tmp, file);
  } catch {
    // fail-open: no record means the file's reviews decides
  }
}

// Stop reason when the reply's approval block names an item whose review has not settled.
export function closingReviewReason(data: HookInput, named: Approvable[] | null): string | null {
  if (named === null) return null;
  const ws = resolveRoots(data).root;
  const open = readReviewsOpen(data);

  for (const n of named) {
    const state = reviewStateOf(ws, open, n);

    if (state === "unreviewed")
      return `${itemKey(n)} has reviews: 0; run /review-${n.kind} ${n.serial} in a fresh agent first`;

    if (state === "open") return `${itemKey(n)}'s review has not settled; wait for it, ${SETTLE_THEN_CLOSE}`;
  }

  return null;
}
