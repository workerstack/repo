/** Directory, headings, limits and denials the fast roadmap saver and its checks share. */

import { REPO } from "../repo-dirs.ts";

export const FAST_ROADMAP_DIR: string = `${REPO}/roadmaps-fast`;

/** The only `## ` sections a fast roadmap holds, in order. */
export const FAST_ROADMAP_H2: readonly string[] = ["Order", "Verify"];

/** The frontmatter keys a fast roadmap must carry. */
export const FAST_ROADMAP_REQUIRED_KEYS: readonly string[] = ["serial", "name", "status", "created", "source"];

/** A saved fast roadmap, frontmatter included and Location lines not, is at most this many lines. */
export const FAST_ROADMAP_LINE_CAP = 20;

/** A fast roadmap lists at least this many slices. */
export const FAST_SLICES_MIN = 2;

export const FAST_ROADMAP_NAME_RE: RegExp = /^\s*FAST_ROADMAP_NAME:\s*(\S.*?)\s*$/;

/** The Order section, the source when no name or caller gives one. */
export const FAST_ORDER_RE: RegExp = /## Order\n([\s\S]*?)\n## /;

/** A fast plan's file under `.repo/plans-fast/`, by its last two folder segments. */
export const FAST_PLANS_SEGMENTS: readonly string[] = [".repo", "plans-fast"];

export const PATH_SEPARATOR_RE: RegExp = /[\\/]/;

export const NO_STRATEGY = "a fast roadmap has no strategy";
export const ONLY_SECTIONS = "a fast roadmap holds only Order and Verify, then an optional Previous mistakes";
export const TOO_LONG = "a fast roadmap is at most 20 lines; write a roadmap (/write-roadmap)";
export const TOO_FEW_SLICES = "a fast roadmap has two or more slices; write a fast plan (/write-plan-fast)";
export const ONLY_OPEN_BOXES = "a new fast roadmap has only [ ] boxes";
export const LOCATION_NOT_FAST_PLAN = "a fast roadmap slice's Location is a fast plan under .repo/plans-fast/";
