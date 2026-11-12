/** Inherited repo pointers that would aim git at another repo. */
export const GIT_ENV_DROP: readonly string[] = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_CEILING_DIRECTORIES",
];

/** An unanchored line is checked one level deeper too, where a top-anchored parent rule stops matching. */
export const PROBE_DIR = ".workerstack-probe";
export const GITIGNORE = ".gitignore";

/** What `indexOf` and `findIndex` return for no match. */
export const NOT_FOUND = -1;
export const LINE_BREAK_RE: RegExp = /\r?\n/;
export const COMMENT_MARK = "#";
export const NEGATION_MARK = "!";

/** A Codex patch: a file header, and the `+` lines under it. */
export const PATCH_HEADER_RE: RegExp = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/;
export const MOVE_TO = "Move to";
export const DELETE_FILE = "Delete File";
export const PLUS_MARK = "+";

/** A char a plain shell parse cannot read literally outside quotes. */
export const UNSAFE_CHAR: RegExp = /[;&$`(){}<*?[\]\\#~!]/;

/** Text in double quotes, or in an unquoted heredoc, that the shell would expand. */
export const EXPANDS_RE: RegExp = /[$`\\]/;
export const ESCAPE_RE: RegExp = /\\(.)/g;

/** The escapes `printf` and `echo -e` turn into a char; any other escaped char stands for itself. */
export const ESCAPES: ReadonlyMap<string, string> = /* @__PURE__ */ new Map([
  ["n", "\n"],
  ["t", "\t"],
]);

export const ECHO_FLAGS_RE: RegExp = /^-[neE]+$/;
export const PERCENT_ESCAPE = "%%";
export const HEREDOC_RE: RegExp = /<<(-?)\s*(['"]?)(\w+)\2/;
export const LEADING_TABS_RE: RegExp = /^\t+/;
export const TRAILING_SPACE_RE: RegExp = /\s+$/;
export const PRINTF = "printf";
export const ECHO = "echo";
export const CAT = "cat";
export const TEE = "tee";
export const TEE_APPEND = "-a";
export const DEV_NULL = "/dev/null";
export const WRITE_OP = ">";
export const APPEND_OP = ">>";
export const PIPE_OP = "|";

/** A redirect and its target: the last two tokens of a redirected write. */
export const REDIRECT_TOKENS = 2;

/** A line a parent rule can cover only when it has no glob char. */
export const GLOB_CHAR_RE: RegExp = /[*?[\\]/;
export const TRAILING_SLASH_RE: RegExp = /\/$/;
export const LEADING_SLASH_RE: RegExp = /^\//;

/** One `git check-ignore -v --non-matching` row: source, line number, pattern, then the path after a tab. */
export const CHECK_IGNORE_ROW_RE: RegExp = /^(.*?):(\d*):(.*)\t(.*)$/;
