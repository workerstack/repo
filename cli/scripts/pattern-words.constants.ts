/** What `patternWords` knows of each search program's options. */
export type PatternGrammar = {
  /** Short letters that take no value, so a cluster of them never hides the pattern. */
  flagShorts: string;
  /** Long options that take no value. */
  flagLongs: readonly string[];
  /** Short letters that give the pattern another way or end the need for one: any of them means no skip. */
  sourceShorts: string;
  /** Long options that do the same; an abbreviation of one counts too. */
  sourceLongs: readonly string[];
};

export const END_OF_OPTIONS = "--";

/** The grep family's no-value letters (GNU and BSD); `A B C D d e f m` take a value and are left out. */
const GREP_SHORTS = "abcEFGHhIiLlnoPqRrsTUvwxyZz";

const GREP_LONGS: readonly string[] = [
  "--basic-regexp",
  "--byte-offset",
  "--count",
  "--dereference-recursive",
  "--extended-regexp",
  "--files-with-matches",
  "--files-without-match",
  "--fixed-strings",
  "--ignore-case",
  "--initial-tab",
  "--invert-match",
  "--line-number",
  "--line-regexp",
  "--no-filename",
  "--no-ignore-case",
  "--no-messages",
  "--null",
  "--null-data",
  "--only-matching",
  "--perl-regexp",
  "--quiet",
  "--recursive",
  "--silent",
  "--text",
  "--with-filename",
  "--word-regexp",
];

/** rg's no-value letters; `A B C d E e f g j M m r T t` take a value and are left out. */
const RG_SHORTS = "abcFHhIiLlNnoPpqSsUuvwxz0";

const RG_LONGS: readonly string[] = [
  "--byte-offset",
  "--case-sensitive",
  "--column",
  "--count",
  "--count-matches",
  "--files-with-matches",
  "--files-without-match",
  "--fixed-strings",
  "--follow",
  "--heading",
  "--hidden",
  "--ignore-case",
  "--invert-match",
  "--json",
  "--line-number",
  "--line-regexp",
  "--multiline",
  "--no-filename",
  "--no-heading",
  "--no-ignore",
  "--no-line-number",
  "--no-messages",
  "--null",
  "--only-matching",
  "--pcre2",
  "--quiet",
  "--search-zip",
  "--smart-case",
  "--text",
  "--trim",
  "--unrestricted",
  "--vimgrep",
  "--with-filename",
  "--word-regexp",
];

/** fd's no-value letters; `c d E e j o S t X x` take a value and are left out. */
const FD_SHORTS = "0aFgHhIiLlpqsu";

const FD_LONGS: readonly string[] = [
  "--absolute-path",
  "--case-sensitive",
  "--fixed-strings",
  "--follow",
  "--full-path",
  "--glob",
  "--hidden",
  "--ignore-case",
  "--list-details",
  "--no-ignore",
  "--print0",
  "--quiet",
  "--regex",
  "--unrestricted",
];

/** `-e` and `-f` give grep and rg the pattern another way. */
const GREP_SOURCE_SHORTS = "ef";

const GREP_SOURCE_LONGS: readonly string[] = ["--regexp", "--file"];

/** rg's `--files` and `--type-list` run with no pattern, so their first operand is a path. */
const RG_SOURCE_LONGS: readonly string[] = [...GREP_SOURCE_LONGS, "--files", "--type-list"];

const GREP: PatternGrammar = {
  flagLongs: GREP_LONGS,
  flagShorts: GREP_SHORTS,
  sourceLongs: GREP_SOURCE_LONGS,
  sourceShorts: GREP_SOURCE_SHORTS,
};

/** find, the one program whose name-test values are skipped. */
export const FIND_PROGRAM = "find";

/** Each program whose first operand is its pattern, by name. */
export const PATTERN_COMMANDS: ReadonlyMap<string, PatternGrammar> = /* @__PURE__ */ new Map([
  ["grep", GREP],
  ["egrep", GREP],
  ["fgrep", GREP],
  [
    "rg",
    { flagLongs: RG_LONGS, flagShorts: RG_SHORTS, sourceLongs: RG_SOURCE_LONGS, sourceShorts: GREP_SOURCE_SHORTS },
  ],
  ["fd", { flagLongs: FD_LONGS, flagShorts: FD_SHORTS, sourceLongs: [], sourceShorts: "" }],
]);

/** find tests whose value is a name pattern, never a file find opens. */
export const FIND_NAME_TESTS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "-name",
  "-iname",
  "-path",
  "-ipath",
  "-wholename",
  "-iwholename",
  "-regex",
  "-iregex",
  "-lname",
  "-ilname",
]);

/** find actions that run a command; their words up to the end mark are that command's. */
export const EXEC_ACTIONS: ReadonlySet<string> = /* @__PURE__ */ new Set(["-exec", "-execdir", "-ok", "-okdir"]);

export const EXEC_END = ";";

/** `+` ends an action only right after `{}`. */
export const EXEC_BATCH_END = "+";

export const EXEC_BATCH_MARK = "{}";
