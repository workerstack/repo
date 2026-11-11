/** What a job prints when the caller should run the plain command instead. */
export const FALLBACK = "FALLBACK";
/** The exit code that goes with `FALLBACK`. */
export const FALLBACK_EXIT = 2;
/** The most fact lines a verdict shows. */
export const MAX_FACTS = 6;
/** Output past this many bytes goes to a stash. */
export const MAX_STDOUT: number = 32 * 1024;
/** The most bytes a stash holds. */
export const STASH_CAP: number = 2 * 1024 * 1024;
/** The most hits a search collects. */
export const MAX_HITS = 10_000;
/** Where stashes live, relative to the root. */
export const STASH_REL = ".tmp/repo/stash";

/** The jobs `repo job` runs. */
export const SEARCH_JOB = "search";
export const EXEC_JOB = "exec";
export const SLICE_JOB = "slice";
export const FETCH_JOB = "fetch";
export const JOBS: ReadonlySet<string> = /* @__PURE__ */ new Set([SEARCH_JOB, EXEC_JOB, "test", SLICE_JOB, FETCH_JOB]);

/** The flags `repo job` reads. */
export const FLAG_PREFIX = "--";
export const JOB_FLAG = "--job";
export const QUERY_FLAG = "--query";
export const PATH_FLAG = "--path";
export const GLOB_FLAG = "--glob";
export const CWD_FLAG = "--cwd";
export const STASH_FLAG = "--stash";
export const FROM_FLAG = "--from";
export const TO_FLAG = "--to";
export const KNOWN_FLAGS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  JOB_FLAG,
  QUERY_FLAG,
  PATH_FLAG,
  GLOB_FLAG,
  CWD_FLAG,
  STASH_FLAG,
  FROM_FLAG,
  TO_FLAG,
]);

/** Query words and paths a job refuses: generated dirs as whole segments, the lockfile, downloads, html and .git. */
export const DENY_SEGS: readonly string[] = ["node_modules", "dist", ".next", "build", "coverage"];
export const DENY_QUERY: readonly RegExp[] = [/\b(curl|wget)\b/i, /<\s*html\b/i, /<\s*!DOCTYPE html/i, /\bbun\.lock\b/];
export const DENY_GIT: RegExp = /(^|[\s/])\.git(\/|$)/;
export const HTML_RES: readonly RegExp[] = [/<\s*html\b/i, /<\s*!DOCTYPE html/i];
export const HTTP_URL: RegExp = /^https?:\/\//i;

/** How `squeezLines` ranks a line: failures first, then query hits, then the ends, then the rest; passes last. */
export const FAIL_RE: RegExp = /\b(FAIL(?:ED)?|ERROR|Error:|Exception|panic|E\d{3,})\b/;
export const STACK_RE: RegExp = /^\s+at\s/;
export const PASS_RE: RegExp = /^\s*(✓|√|PASS|ok |passed)\b/i;
export const FAIL_SCORE = 100;
export const QUERY_SCORE = 50;
export const END_SCORE = 20;
export const PLAIN_SCORE = 10;
export const PASS_SCORE = 0;

/** The most error lines a failed verdict shows, and the most lines any verdict prints. */
export const MAX_ERRORS = 3;
export const MAX_TEXT_LINES = 8;
/** How much of one line a fact keeps, and of a line that is no `file:line:text` hit. */
export const FACT_WIDTH = 120;
export const LINE_WIDTH = 160;
/** The units a verdict counts in: [one, many]. */
export const MATCH_UNITS: readonly [string, string] = ["match", "matches"];
export const LINE_UNITS: readonly [string, string] = ["line", "lines"];
export const NO_MATCHES = "No matches.";
export const NO_OUTPUT = "No output.";
export const SEARCH_FAILED = "Search failed.";
export const COMMAND_FAILED = "Command failed.";
export const MISSING_STASH = "missing stash";
export const BINARY_STASH = "binary stash";
export const EMPTY_PAGE = "(empty)";

/** The stash name: random bytes spelled in this alphabet. */
export const STASH_ID_BYTES = 4;
export const STASH_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export const STASH_EXT = ".txt";

/** How long a command or a fetch may run, and the room past a full stash its output may take. */
export const CMD_TIMEOUT_MS = 20_000;
export const FETCH_TIMEOUT_MS = 20_000;
export const BUFFER_SLACK = 4096;
/** The error code of a binary that is not on PATH. */
export const NOT_FOUND = "ENOENT";
export const RTK = "rtk";
export const RTK_SUFFIX = "/rtk";

/** What the node search skips: these dirs, files past this size. */
export const SEARCH_SKIP_DIRS: ReadonlySet<string> = /* @__PURE__ */ new Set([...DENY_SEGS, ".git"]);
export const SEARCH_MAX_FILE: number = 200 * 1024;
/** A glob part that matches any number of whole dirs, none included. */
export const GLOBSTAR_DIR = "**/";
export const RG = "rg";
/** rg exits 1 when nothing matched. */
export const RG_NO_MATCH = 1;
// --hidden: .repo/ (lessons, overlay) and the generated host trees (.claude, .agents, .grok, .codex) are dot dirs; .gitignore still applies.
export const RG_ARGS: readonly string[] = [
  "-n",
  "--hidden",
  "--max-count",
  `${MAX_HITS}`,
  "--max-filesize",
  "200K",
  "-g",
  "!node_modules",
  "-g",
  "!dist",
  "-g",
  "!coverage",
  "-g",
  "!.next",
  "-g",
  "!build",
  "-g",
  "!.git",
];

/** The child script a fetch runs: it fetches argv[1] and writes at most a stash of its body. */
export const FETCH_SCRIPT: string = `
    const u = process.argv[1];
    const cap = ${STASH_CAP};
    fetch(u, { redirect: "follow" })
      .then(async (r) => {
        const buf = Buffer.from(await r.arrayBuffer());
        process.stdout.write(buf.subarray(0, cap));
      })
      .catch((e) => {
        process.stderr.write(String(e && e.message ? e.message : e));
        process.exit(1);
      });
  `;
export const FETCH_FAILED = "fetch failed";
