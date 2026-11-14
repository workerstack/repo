/** Directory, headings, limits and denials the fast plan saver and its checks share. */

import { REPO } from "../repo-dirs.ts";

export const FAST_PLAN_DIR: string = `${REPO}/plans-fast`;

/** The only `## ` sections a fast plan holds, in order. */
export const FAST_H2: readonly string[] = ["Goal", "Steps", "Verify"];

/** The frontmatter keys a fast plan must carry. */
export const FAST_REQUIRED_KEYS: readonly string[] = ["serial", "name", "status", "created", "source"];

/** A saved fast plan, frontmatter included, is at most this many lines. */
export const FAST_LINE_CAP = 40;

export const FAST_PLAN_NAME_RE: RegExp = /^\s*FAST_PLAN_NAME:\s*(\S.*?)\s*$/;
export const FAST_GOAL_RE: RegExp = /## Goal\n([\s\S]*?)\n## /;

/** A flat box line, `N [ ] text`, and one already ticked. */
export const FAST_TICKED_RE: RegExp = /^\d+ \[[xX]\] /m;

export const FINAL_NEWLINE_RE: RegExp = /\n$/;

export const NO_STRATEGY = "a fast plan has no strategy";
export const ONLY_SECTIONS = "a fast plan holds only Goal, Steps and Verify, then an optional Previous mistakes";
export const TOO_LONG = "a fast plan is at most 40 lines; write a plan (/write-plan-deep)";
export const ONLY_OPEN_BOXES = "a new fast plan has only [ ] boxes";
