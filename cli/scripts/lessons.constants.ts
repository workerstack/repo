/** The lessons dir under a checkout, and the generated index in it. */
export const LESSONS_DIR = ".repo/lessons";
export const INDEX_NAME = "INDEX.md";

/** A lesson file is at most this many lines. */
export const MAX_LINES = 60;

/** A lesson keeps this many of its most recent evidence entries. */
export const MAX_EVIDENCE = 5;

/** `matchLessons` returns at most this many rows unless the caller asks for another cap. */
export const DEFAULT_CAP = 10;
export const MD_EXT = ".md";

/** What `indexOf` and `findIndex` return for no match. */
export const NOT_FOUND = -1;
export const SLUG_RE: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DATE_RE: RegExp = /^\d{4}-\d{2}-\d{2}$/;

/** The frontmatter keys a lesson may hold. */
export const KEYS: readonly string[] = ["name", "paths", "hits", "last-hit", "evidence"];

/** The dirs a walk of a checkout without git skips. */
export const SKIP_WALK: ReadonlySet<string> = /* @__PURE__ */ new Set([".git", "node_modules", ".tmp"]);

export const USAGE =
  "usage: bun repo lessons match <file...> | hit <slug> --evidence <text> | rm <slug> | index | check";

export const EVIDENCE_FLAG = "--evidence";

/** Frontmatter: the open and close fences, and one `key: value` line. */
export const FM_OPEN = "---\n";
export const FM_CLOSE = "\n---\n";
export const FM_LINE_RE: RegExp = /^([a-z-]+):\s*(.*)$/;
export const BOM_RE: RegExp = /^﻿/;
export const FM_MISSING = "start with --- frontmatter (name, paths, hits, last-hit, evidence)";

/** The body: a `# ` title, then `## Mistake` and `## Fix`. */
export const H1_RE: RegExp = /^# \S/;
export const H1_PREFIX = "# ";
export const H2_PREFIX = "## ";
export const MISTAKE = "Mistake";
export const FIX = "Fix";
export const SECTIONS: readonly string[] = [MISTAKE, FIX];
export const HEADING_MARK = "#";

/** Glob tokens, longest first, and the regex source each stands for; any other char is matched literally. */
export const GLOB_TOKENS: readonly (readonly [string, string])[] = [
  ["**/", "(?:.*/)?"],
  ["**", ".*"],
  ["*", "[^/]*"],
  ["?", "[^/]"],
];

export const REGEX_SPECIAL_RE: RegExp = /[.+^${}()|[\]\\]/g;
export const TRAILING_NL_RE: RegExp = /\n$/;

/** An index row: `| file | paths | hits | last-hit | summary |`. */
export const ROW_PREFIX: string = `| ${LESSONS_DIR}/`;

/** The `| ` before a row's first cell and the ` |` after its last. */
export const ROW_EDGE = 2;
export const CELL_SEP = " | ";
export const INDEX_CELLS = 5;
export const PATHS_SEP = ", ";
export const ESCAPED_PIPE = "\\|";
export const PIPE = "|";
export const SPACES_RE: RegExp = /\s+/g;
export const NUL = "\u0000";
