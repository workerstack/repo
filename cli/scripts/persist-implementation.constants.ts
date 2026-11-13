/** Names, patterns and limits the journal saver and its validator share. */
import { REPO } from "../repo-dirs.ts";

export const IMPLEMENTATION_DIR: string = `${REPO}/implementations`;

/** `{serial}-{slug}-{YYYYMMDDTHHMMSSZ}.md`; stamp required for new writes. */
export const FILENAME_RE: RegExp = /^[0-9]+-[a-z0-9]+(-[a-z0-9]+)*-\d{8}T\d{6}Z\.md$/;
export const STATUS_RE: RegExp = /^(in-progress|done|blocked)$/;
export const PLAN_VALUE_RE: RegExp = /^(none|[1-9][0-9]*)$/;
export const PLAN_NUMBER_RE: RegExp = /^[1-9][0-9]*$/;
export const NO_PLAN = "none";
export const REQUIRED_KEYS: readonly string[] = ["serial", "plan", "name", "status", "created", "source"];
export const REQUIRED_H2: readonly string[] = ["Done", "Issue", "Files", "Log", "Blockers", "Notes"];

/** Sections that hold bullets or `(none)`, in report order. */
export const BULLET_H2: readonly string[] = ["Done", "Issue", "Log", "Blockers", "Notes"];

/** The `N.M [ ]` line a Log may hold in place of a bullet. */
export const LOG_BOX_RE: RegExp = /^\d+\.\d+(?:\.\d+)? \[[ xX]\] /;
export const BULLET_RE: RegExp = /^[-*] /;
export const WINDOWS_DRIVE_RE: RegExp = /^[A-Za-z]:/;
export const LOG_H2 = "Log";
export const FILES_H2 = "Files";
export const BLOCKERS_H2 = "Blockers";
export const BLOCKED_STATUS = "blocked";
export const TMP_SEGMENT: string = `${REPO}/`;
export const META_LINE_RE: RegExp = /^\s*IMPL_(NAME|PLAN):\s*.+\s*$/;
export const NAME_RE: RegExp = /^\s*IMPL_NAME:\s*(.+?)\s*$/m;
export const PLAN_RE: RegExp = /^\s*IMPL_PLAN:\s*(.+?)\s*$/m;
export const DONE_SECTION_RE: RegExp = /## Done\n([\s\S]*?)\n## /;
export const FULL_BODY_RES: readonly RegExp[] = [/^---\n/, /^# /m, /^## Done\b/m];
