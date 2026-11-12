/** Fences, limits and patterns every saved doc kind shares. */

/** The line that opens a frontmatter block. */
export const FM_OPEN = "---\n";

/** The line that closes a frontmatter block, newline before it included. */
export const FM_CLOSE = "\n---\n";

/** A frontmatter value `source:` is cut to this many characters. */
export const SOURCE_MAX = 120;

/** A slug is cut to this many characters. */
export const SLUG_MAX = 50;

/** What `indexOf` returns for no match. */
export const NOT_FOUND = -1;

/** The headings and marker line several checks name. */
export const MISTAKES_H2 = "Previous mistakes";
export const USAGE_H2 = "Usage";
export const GOAL_H2 = "Goal";
export const NONE_LINE = "(none)";

/** Radix of a serial number. */
export const DECIMAL = 10;

/** Characters in `YYYY-MM-DD`. */
export const DATE_LENGTH = 10;

export const SERIAL_LINE_RE: RegExp = /^serial: [1-9][0-9]*$/;
export const DATETIME_RE: RegExp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const CREATED_RE: RegExp = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/;
export const FILENAME_STAMP_RE: RegExp = /-\d{8}T\d{6}Z$/;

/** `key: value` in a plan, handoff or journal: the space after the colon is required. */
export const FM_LINE_RE: RegExp = /^([a-z]+):(?:\s+(.*))?$/;

/** `key:value` in a roadmap: any space, or none, after the colon. */
export const FM_LINE_LOOSE_RE: RegExp = /^([a-z]+):\s*(.*)$/;

/** The first `# ` heading line of a doc. */
export const H1_RE: RegExp = /^#\s+(.+?)\s*$/m;

/** The serial a saved file's name starts with. */
export const SERIAL_PREFIX_RE: RegExp = /^([0-9]+)-/;

/** Milliseconds in an ISO time. */
export const MILLIS_RE: RegExp = /\.\d{3}Z$/;

/** A save tries this many serials past the first before it reports a collision. */
export const NAME_TRIES = 5;
