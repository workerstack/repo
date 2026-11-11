/** The live agent board's limits, file layout, process probes and label filters. */

/** A work label's length cap, in chars. */
export const WORK_CAP = 80;
/** How many parent processes a host lookup walks past. */
export const MAX_WALK = 4;
/** How many other sessions a digest lists. */
export const DIGEST_CAP = 8;
/** The text of an empty field. */
export const NONE = "-";
/** The session id a harness sends when it has none. */
export const DEFAULT_SESSION = "default";
/** The work label of a session that has said nothing yet. */
export const ACTIVE = "active";
export const REDACTED = "[redacted]";

/** Under the board home: the dir that holds one row file per session. */
export const BOARD_PARTS: readonly string[] = [".workerstack", "board"];
export const ROW_EXT = ".json";
export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;
/** The radix of the random part of a temp file name. */
export const HEX = 16;
/** The `0.` a random number's text starts with. */
export const RANDOM_SKIP = 2;

export const LINUX = "linux";
export const DARWIN = "darwin";
export const WIN32 = "win32";
export const BOOT_ID_FILE = "/proc/sys/kernel/random/boot_id";
/** /proc/pid/stat after "(comm)": the fields up to starttime (field 22), and starttime's index among them. */
export const STAT_FIELDS = 20;
export const STAT_START = 19;
export const ZOMBIE = "Z";
/** `ps -o ppid=,lstart=,comm=`: the parent pid, the start time and the command. */
export const PS_LINE_RE: RegExp = /^(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s*$/;
/** The powershell probe prints the parent pid, the name and the start time, one a line. */
export const WIN_FIELDS = 3;
export const LINE_BREAK_RE: RegExp = /\r?\n/;
/** Everything up to a path's last separator, either kind. */
export const DIR_PREFIX_RE: RegExp = /^[\s\S]*[/\\]/;
export const EXE_RE: RegExp = /\.exe$/i;

/** The process names a host lookup walks past to reach the agent that started them. */
export const SHELLS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "sh",
  "bash",
  "dash",
  "zsh",
  "ash",
  "busybox",
  "cmd",
  "powershell",
  "pwsh",
]);

export const SPACES_RE: RegExp = /\s+/g;
export const SPACE_SPLIT_RE: RegExp = /\s+/;
export const UNSAFE_NAME_RE: RegExp = /[^\w.@+-]/g;
export const MILLIS_RE: RegExp = /\.\d{3}Z$/;

// Harness-injected blocks use hyphenated or underscored tags; the typed slash command is the only one kept.
export const STRIP_BLOCKS: readonly RegExp[] = [
  /<\/?(?:command-name|command-args)>/g,
  /<([a-z]+(?:[-_][a-z]+)+)\b(?:[^>]*>[\s\S]*?(?:<\/\1[^>]*>|$)|[^>]*$)/g,
  /\[Image #\d+\]/g,
  /\[Pasted text #\d+[^\]]*\]/g,
];
export const SECRET_AFTER_KEY: readonly RegExp[] = [
  /\b(password|passwd|bearer)(\s*[:=]\s*|\s+)\S+/gi,
  /\b(pwd|token|secret|api[-_]?key|apikey)(\s*[:=]\s*)\S+/gi,
];
export const SECRET_PREFIX_RE: RegExp =
  /\b(?:sk-|ghp_|gho_|github_pat_|xox[abpr]-|AKIA|AIza|glpat-)[A-Za-z0-9_-]{16,}/g;
/** An opaque token: this long at least, no path or slug punctuation, and upper, lower and digit chars all present. */
export const OPAQUE_MIN = 24;
export const OPAQUE_PUNCT_RE: RegExp = /[/.-]/;
export const UPPER_RE: RegExp = /[A-Z]/;
export const LOWER_RE: RegExp = /[a-z]/;
export const DIGIT_RE: RegExp = /\d/;
