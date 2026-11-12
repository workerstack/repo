import type { BuildItem } from "./build-dirs.ts";
import type { Policy } from "./clean.types.ts";

/** The byte units `size` prints. */
export const KB = 1024;
export const MB: number = KB * KB;
export const GB: number = MB * KB;

/** An entry touched within this window counts as recent. */
export const HOUR = 3600_000;

/** A stash receipt lives this long. */
export const DAY: number = 24 * HOUR;

/** Repo files untouched this long age out (roadmap D12). */
export const AGE: number = 30 * DAY;

/** The dirs that hold repo's durable files; a nested .tmp/repo holding a file in one is kept. */
export const PLANS_DIR = "plans";
export const ROADMAPS_DIR = "roadmaps";
export const DURABLE: readonly string[] = [PLANS_DIR, ROADMAPS_DIR, "handoffs", "implementations"];

/** The status of a finished plan, roadmap, journal or handoff. */
export const DONE_STATUS = "done";

/** The extension `nextSerial` counts in every dir but roadmaps. */
export const MD_EXT = ".md";

/** The kept kind of a nested .tmp/repo that holds durable files. */
export const NESTED_KIND = "nested";

/** No serial seen yet; every real serial is above it. */
export const NO_SERIAL = -1;

/** The slashes git's `--directory` listing ends a dir entry with. */
export const TRAILING_SLASHES_RE: RegExp = /\/+$/;

// How each repo-owned dir is cleaned. A reserved dir with no policy fails at load, so a new one is never deleted
// silently.
// clean.test.ts holds POLICY to TMP_RESERVED_DIRS, so a reserved dir without a policy fails the suite.
export const POLICY: Readonly<Record<string, Policy>> = {
  browser: "keep",
  handoffs: "age",
  implementations: "age-done",
  listen: "keep",
  "orchestrator-logs": "per-stamp",
  plans: "age-done",
  roadmaps: "age-done",
  sessions: "per-session",
  speak: "keep",
  stash: "per-receipt",
};

/** The removed kind of an aged-out file, by its dir. */
export const OLD_KIND: Readonly<Record<string, string>> = {
  handoffs: "old handoff",
  implementations: "old journal",
  plans: "old plan",
  roadmaps: "old roadmap",
};

export const SERIAL_RE: RegExp = /^([0-9]+)-/;
export const FRONTMATTER_RE: RegExp = /^---\r?\n([\s\S]*?)\r?\n---/;
export const STATUS_RE: RegExp = /^status:\s*(\S+)/m;
export const LOCATION_RE: RegExp = /^\s*Location:\s*(\S+)\s*$/gm;

/** git lists every ignored dir in one call; its output may be large. */
export const GIT_MAX_BUFFER: number = 256 * 1024 * 1024;

/** How often a delete retries a busy path. */
export const RM_RETRIES = 3;

/** The exit code of a bad flag combination. */
export const USAGE_EXIT = 2;
export const BUILD_FLAG = "--build";
export const DEPS_FLAG = "--deps";
export const DRY_RUN_FLAG = "--dry-run";

/** The order the report counts removed kinds in, and their plurals. */
export const REMOVE_ORDER: readonly string[] = [
  "file",
  "dir",
  "dead session",
  "stale stamp",
  "stash receipt",
  "nested dir",
  "old plan",
  "old roadmap",
  "old journal",
  "old handoff",
  "old tmp artifact",
];

export const PLURAL: Readonly<Record<string, string>> = {
  "dead session": "dead sessions",
  dir: "dirs",
  file: "files",
  "nested dir": "nested dirs",
  "old handoff": "old handoffs",
  "old journal": "old journals",
  "old plan": "old plans",
  "old roadmap": "old roadmaps",
  "old tmp artifact": "old tmp artifacts",
  "stale stamp": "stale stamps",
  "stash receipt": "stash receipts",
};

/** The order the report counts kept kinds in past the durable dirs, and their plurals. */
export const KEEP_ORDER: readonly string[] = ["tmp artifact", "live session", "recent"];

export const KEEP_PLURAL: Readonly<Record<string, string>> = {
  "live session": "live sessions",
  recent: "entries touched recently",
  "tmp artifact": "tmp artifacts",
};

/** The build kinds in report order, and each one's [one, many] name. */
export const BUILD_KINDS: readonly BuildItem["kind"][] = ["dir", "info", "modules"];

export const BUILD_PLURAL: Readonly<Record<BuildItem["kind"], readonly [string, string]>> = {
  dir: ["build dir", "build dirs"],
  info: ["tsbuildinfo file", "tsbuildinfo files"],
  modules: ["node_modules", "node_modules"],
};
