/** Names, patterns and limits the roadmap saver and its validator share. */
import { PLAN_MISTAKE_SOURCES } from "./persist-mistakes.ts";
import { gateOf } from "./persist-plan.constants.ts";

export const ROADMAP_DIR = ".tmp/repo/roadmaps";
export const ROADMAP_FILENAME_RE: RegExp = /^[0-9]+-[a-z0-9]+(-[a-z0-9]+)*-\d{8}T\d{6}Z\.md$/;
export const STATUS_RE: RegExp = /^(draft|locked|in-progress|done|blocked)$/;
export const REQUIRED_KEYS: readonly string[] = ["serial", "name", "status", "created", "source"];
export const REQUIRED_H2: readonly string[] = ["Goal", "Context", "Decisions", "Order", "Watch-outs", "Verify"];

/** Legacy sections that must hold bullets. */
export const BULLET_H2: readonly string[] = ["Context", "Decisions", "Watch-outs"];
export const BULLETS_RE: RegExp = /^(?:[-*] |\(none\))/m;

/** A roadmap also logs `slice`: what a child plan found that changed the program. */
export const ROADMAP_MISTAKE_SOURCES: readonly string[] = [...PLAN_MISTAKE_SOURCES, "slice"];

/** Statuses a roadmap may enter only after that many settled `/review-roadmap` rounds. */
const REVIEWS_TO_ENTER = { locked: 1 } as const satisfies Readonly<Record<string, number>>;

/** The settled `/review-roadmap` rounds a roadmap needs to enter `status`, or undefined when it needs none. */
export function reviewsToEnter(status: string): number | undefined {
  return gateOf(REVIEWS_TO_ENTER, status);
}

export const REVIEW_COMMAND = "/review-roadmap {n}";

/** The keys a legacy slice carries under its `Title:` line. */
export const GOAL_KEY = "Goal";
export const WHY_KEY = "Why";
export const DRAFT_STATUS = "draft";
export const SLICE_RE: RegExp = /^(?: {0,2})(?<n>\d+) \[(?<mark>[ xX])\] Title: (?<title>.+)$/;
export const KEY_RE: RegExp = /^ {2,8}(?<key>Goal|Why|Location): (?<value>.*)$/;
export const BOX_RE: RegExp = /^(?: {0,2})(?<id>\d+(?:\.\d+){0,2}) \[(?<mark>[ xX])\] (?<text>.+)$/;
export const LEAF_RE: RegExp = /^\d+\.\d+/;

/** A roadmap with no `## Goal` is a pointer roadmap: the card, one line per slice, Verify. */
export const POINTER_H2: readonly string[] = ["Order", "Verify"];
export const POINTER_LINE_CAP = 60;
export const POINTER_CAP_FIX = "move detail into the slice plans";
export const POINTER_SLICE_RE: RegExp = /^(?: {0,2})(?<n>\d+) \[[ xX]\] (?<text>.*)$/;
export const POINTER_TEXT_RE: RegExp = /^(?<title>.+?): (?<sentence>.+)$/;
export const LOCATION_LINE_RE: RegExp = /^\s+Location: (.*)$/;
export const DRIVE_RE: RegExp = /^[A-Za-z]:[\\/]/;
export const SENTENCE_SPLIT_RE: RegExp = /(?<=[.!?])(?:\s+|$)/;
export const WORD_SPLIT_RE: RegExp = /\s+/;

/** A slice title or pointer title is this many words. */
export const TITLE_WORDS_MIN = 2;
export const TITLE_WORDS_MAX = 6;
export const GOAL_SENTENCES_MAX = 3;
export const WHY_SENTENCES_MAX = 2;

/** An Order lists at least this many slices. */
export const SLICES_MIN = 2;

/** A Verify lists one to this many `N.M` leaves. */
export const LEAVES_MAX = 5;
export const ROADMAP_NAME_RE: RegExp = /^ROADMAP_NAME:\s*(.+)\s*$/m;
export const ROADMAP_NAME_STRIP_RE: RegExp = /^ROADMAP_NAME:\s*.+\n/m;
export const GOAL_SECTION_RE: RegExp = /## Goal\n([\s\S]*?)\n## /;
