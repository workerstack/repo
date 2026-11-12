/** Directories, patterns and limits the plan saver and its checks share. */

import { TYPES } from "../conventional.ts";

export const PLAN_DIR = ".tmp/repo/plans";

/** Old unstamped names and new `{serial}-{slug}-{YYYYMMDDTHHMMSSZ}.md`. */
export const FILENAME_RE: RegExp = /^[0-9]+-[a-z0-9]+(-[a-z0-9]+)*(-\d{8}T\d{6}Z)?\.md$/;
export const STATUS_RE: RegExp = /^(ready|in-progress|done|blocked)$/;
const COMMIT_SCOPE = "(?:\\([a-z0-9]+(?:-[a-z0-9]+)*\\))?";
const COMMIT_TEXT = "[a-z0-9](?:[a-z0-9 .'/:_,-]*[a-z0-9])?";
const TYPE_ALTERNATION = /* @__PURE__ */ TYPES.join("|");

/**
 * Conventional Commits subject with a type commit-msg accepts. Scope and `!` optional. Lowercase, no trailing
 * period.
 */
export const COMMIT_SUBJECT_RE: Readonly<RegExp> = /* @__PURE__ */ new RegExp(
  `^(?:${TYPE_ALTERNATION})${COMMIT_SCOPE}!?: ${COMMIT_TEXT}$`,
);

/** The frontmatter keys a plan must carry. */
export const REQUIRED_KEYS: readonly string[] = ["serial", "name", "status", "created", "source"];
export const REQUIRED_H2: readonly string[] = ["Goal", "Context", "Constraints", "Watch-outs", "Steps", "Verify"];

/** Sections that must hold bullets or `(none)`. */
export const BULLET_H2: readonly string[] = ["Context", "Constraints", "Watch-outs"];
export const BULLETS_RE: RegExp = /^(?:[-*] |\(none\))/m;

/** Statuses a plan may enter only after that many settled `/review-plan` rounds. */
export const REVIEWS_TO_ENTER: Readonly<Record<string, number>> = { "in-progress": 1 };
export const REVIEW_COMMAND = "/review-plan {n}";

/** The Goal is one to this many sentences. */
export const GOAL_SENTENCES_MAX = 3;
export const SENTENCE_SPLIT_RE: RegExp = /(?<=[.!?])(?:\s+|$)/;
export const VERIFY_RE: RegExp = /^Verify\b/i;
export const GOAL_SECTION_RE: RegExp = /## Goal\n([\s\S]*?)\n## /;
export const WATCH_OUTS_H2 = "Watch-outs";

export const BOX_RE: RegExp = /^( {0,2})(?<id>\d+(?:\.\d+){0,2}) \[(?<mark>[ xX])\] (?<text>.+)$/;
export const PHASE_ID_RE: RegExp = /^\d+$/;
export const LEAF_ID_RE: RegExp = /^\d+\.\d+(?:\.\d+)?$/;
export const PRINCIPLE_READ_RE: RegExp = /^read\s+(?:`principle-[\w-]+`(?:\s*(?:,|and)\s*)?)+\.?$/i;
export const PARALLEL_RE: RegExp = /\(parallel:(?<files>[^)]*)\)\s*$/;
export const FILE_SPLIT_RE: RegExp = /[,\s]+/;

export const PLAN_NAME_RE: RegExp = /^\s*PLAN_NAME:\s*(\S.*?)\s*$/;
export const COMMIT_LINE_RE: RegExp = /^commit:\s*(.*?)\s*$/m;
export const COMMIT_STRIP_RE: RegExp = /^commit:\s*.*\n/m;

/** Paths a plan names, as non-global patterns: callers copy them to scan, so no call leaves match state behind. */
export const ABSOLUTE_PATH: RegExp = /(?<![\w.:\\/-])(?:[A-Za-z]:[\\/]|\/)[^\s`'"()<>,;]+/;

/**
 * A repo-relative path: two or more segments, the last with an extension, not the tail of an absolute path or a
 * URL.
 */
export const RELATIVE_PATH: RegExp = /(?<![\w.:\\/@-])[\w.@-]+(?:[\\/][\w.@-]+)+/;
export const TRAILING_PUNCT_RE: RegExp = /[.:]+$/;
export const EXTENSION_RE: RegExp = /\.[A-Za-z0-9]+$/;
