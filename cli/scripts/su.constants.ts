/** What `repo su` takes: a window of the repo's changes, or the plans and roadmaps one session saved. */
export const SU_SUMMARY = "List a session's plans and roadmaps, or all changed in a window, with boxes and blockers";
export const USAGE = "usage: repo su [--session <id>] [<n>m|<n>h|<n>d|overnight]";

export const SESSION_FLAG = "--session";
export const FLAG_PREFIX = "-";
export const EXIT_USAGE = 2;

/** A window: a count and a unit, or `overnight`. */
export const WINDOW_RE: RegExp = /^([1-9]\d*)([mhd])$/;
export const OVERNIGHT = "overnight";
export const OVERNIGHT_HOURS = 12;
export const UNIT_MS = { d: 86_400_000, h: 3_600_000, m: 60_000 } as const;

export type Unit = keyof typeof UNIT_MS;

export const MS_PER_SECOND = 1000;

/** `YYYY-MM-DDTHH:MM` is this long in an ISO string; the window's start prints as that, then `Z`. */
export const MINUTE_CHARS = 16;

export const IMPLEMENTATIONS_DIR = "implementations";
export const BLOCKERS_HEADING = "## Blockers";
export const HEADING_RE: RegExp = /^## /;
export const BULLET_RE: RegExp = /^[-*]\s+(.*\S)\s*$/;
export const NO_BLOCKER = "(none)";
export const LINE_BREAK_RE: RegExp = /\r?\n/;
export const MD_SUFFIX_RE: RegExp = /\.md$/;
export const NOT_FOUND = -1;

export const UNKNOWN = "?";

/** What a line that is no box leaves: no groups. */
export const NO_GROUPS: Readonly<Record<string, string | undefined>> = {};
export const COMMIT_FORMAT = "--format=%h %s";

export function badWindow(arg: string): string {
  return `repo su: bad window "${arg}"; use 30m, 4h, 2d or overnight`;
}

export function noSessionItems(sid: string): string {
  return `repo su: session ${sid} saved no plan or roadmap`;
}
