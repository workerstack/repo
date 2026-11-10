/** Names, patterns and limits the handoff saver and its validator share. */

export const HANDOFF_DIR = ".tmp/repo/handoffs";
/** `{serial}-{slug}-{YYYYMMDDTHHMMSSZ}.md`; stamp required for new writes. */
export const FILENAME_RE: RegExp = /^[0-9]+-[a-z0-9]+(-[a-z0-9]+)*-\d{8}T\d{6}Z\.md$/;
export const STATUS_RE: RegExp = /^(open|resumed|done)$/;
export const REQUIRED_KEYS: readonly string[] = ["serial", "name", "status", "created", "source"];
export const REQUIRED_H2: readonly string[] = ["Goal", "State", "Context", "Next", "Watch-outs"];
/** Sections that must hold bullets, in report order. */
export const BULLET_H2: readonly string[] = ["State", "Context", "Watch-outs"];
export const BULLETS_RE: RegExp = /^(?:[-*] |\(none\))/m;
export const BOX_RE: RegExp = /^( {0,2})(?<id>\d+(?:\.\d+){0,2}) \[(?<mark>[ xX])\] (?<text>.+)$/;
export const LEAF_ID_RE: RegExp = /^\d+\.\d+(?:\.\d+)?$/;
export const PHASE_ID_RE: RegExp = /^\d+$/;
/** The Goal is one to this many sentences. */
export const GOAL_SENTENCES_MAX = 3;
export const SENTENCE_SPLIT_RE: RegExp = /(?<=[.!?])(?:\s+|$)/;
export const GOAL_SECTION_RE: RegExp = /## Goal\n([\s\S]*?)\n## /;
export const NAME_LINE_RE: RegExp = /^\s*HANDOFF_NAME:\s*(.+?)\s*$/m;
export const NAME_STRIP_RE: RegExp = /^\s*HANDOFF_NAME:\s*.+\s*\n/;
