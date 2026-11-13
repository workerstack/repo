/** Session Grep head_limit when the model omits one. */
export const DEFAULT_GREP_HEAD_LIMIT = 50;

/** Session Read line limit when the model omits one. */
export const DEFAULT_READ_LIMIT = 200;

/** Unknown non-scout child Grep head_limit when omitted. */
export const CHILD_GREP_HEAD_LIMIT = 150;

/** Unknown non-scout child Read line limit when omitted. */
export const CHILD_READ_LIMIT = 400;

/** Deny if requested Grep head_limit or Read limit exceeds this. */
export const MAX_REQUEST_LIMIT = 500;

/** Deny Read when the file is larger than this, even with a line limit. */
export const DENY_FILE_BYTES: number = 200 * 1024;

/** A child type longer than this is a path or a prompt, not an agent name. */
export const MAX_CHILD_TYPE_LENGTH = 64;

export const REASON_DENYLIST = "path denylist; use package API";
export const REASON_FILE_SIZE = "file >200KB";
export const REASON_REREAD = "already wrote this session; Read with offset+limit";

export const REASON_IMPLEMENTER_WRITE =
  "implementer writes product files and tests only; the reviewer writes the plan and the journal";

export const REASON_IMPLEMENTER_GIT =
  "implementer never stages or commits; report the changed files and the reviewer stages them";

/** The tool-name words the gate compares: agents, shells, patch headers and job flags. */
export const SCOUT_TYPES: readonly string[] = ["scout", "researcher"];
export const DEFAULT_SESSION = "default";
export const IMPLEMENTER_PREFIX = "implementer-";
export const RTK = "rtk";
export const BUN = "bun";
export const REPO_WORD = "repo";
export const JOB_WORD = "job";
export const JOB_FLAG = "--job";
export const QUERY_FLAG = "--query";
export const STASH_FLAG = "--stash";

export const JOB_FLAGS: readonly string[] = [
  JOB_FLAG,
  QUERY_FLAG,
  "--path",
  "--glob",
  "--cwd",
  STASH_FLAG,
  "--from",
  "--to",
];

export const PATCH_ADD = "Add File";
export const PATCH_DELETE = "Delete File";
export const PATCH_MOVE = "Move to";
export const PATCH_FIELD = "command";
export const MD_EXT = ".md";
export const GITIGNORE = ".gitignore";
export const WORKTREE_WORD = "worktree";
export const NODE_MODULES = "node_modules";

/** Input keys that show a harness spelling its fields in camelCase. */
export const CAMEL_INPUT_KEYS: readonly string[] = [
  "targetFile",
  "filePath",
  "headLimit",
  "targetDirectory",
  "globPattern",
  "ignoreGlobs",
];

/** Every input field that names a path a search or read aims at. */
export const PATH_FIELDS: readonly string[] = [
  "path",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "target_directory",
  "targetDirectory",
  "glob",
  "glob_pattern",
  "globPattern",
];

export const BASH_DUMP_CMDS: RegExp =
  /\b(cat|tac|less|more|head|tail|nl|bat|hexdump|xxd|rg|grep|egrep|fgrep|find|fd)\b/;

export const BASH_SEARCH: RegExp = /\b(rg|grep|egrep|fgrep|find|fd)\b/;
export const BASH_WEB: RegExp = /\b(curl|wget)\b/;
export const BASH_TREE: RegExp = /\b(ls|tree)\b/;
export const BASH_GIT: RegExp = /\bgit\b/;
export const BASH_URL: RegExp = /https?:\/\/\S+/;

export const TEST_CMD: RegExp =
  /^\s*(?:bun (?:run )?test|bunx? (?:--bun )?vitest|npx vitest|vitest|npm (?:run )?test|pnpm (?:run )?test)\b/;

/** Bun's own test runner at the start of a command or a `;`, `&`, `|` or `(` segment; group 1 precedes it. */
export const BUN_NATIVE_TEST: RegExp = /(^|[;&|(]\s*)bun\s+test\b/g;

/** What `bun test` becomes: the repo's `test` script, which runs vitest. */
export const BUN_SCRIPT_TEST = "bun run test";

/**
 * A local run of the whole ci: `repo ci`, or `bun run ci` (npm, pnpm), followed by the end or a flag, never by a
 * subcommand such as `wait`, `skips`, `times` or `merge`. Each matches at the start of a command or segment.
 */
export const LOCAL_CI_REPO: RegExp =
  /(?:^|[;&|(]\s*)(?:rtk\s+)?(?:bun(?:\s+--bun)?\s+(?:run\s+)?)?(?:\S*\/)?repo(?:\.ts)?\s+ci(?=\s*(?:$|[;&|)])|\s+-)/;

export const LOCAL_CI_SCRIPT: RegExp =
  /(?:^|[;&|(]\s*)(?:rtk\s+)?(?:(?:bun|npm|pnpm)(?:\s+--bun)?\s+run|pnpm)\s+ci(?=\s*(?:$|[;&|)])|\s+-)/;

export const REASON_LOCAL_CI: string =
  "GitHub runs ci, not you: push the branch, then run `bun repo ci wait <branch>` in the background. " +
  "To check one change, run the nearest test file with `bun run test <file>`.";

export const GIT_STAGE: RegExp =
  /(?:^|[\s;&|(])git(?:\s+(?:-[Cc]\s+\S+|--[\w-]+(?:=\S+)?|-\w))*\s+(?:add|commit)(?![\w-])/;

export const SCRATCH_ROOT_RE: RegExp = /^(?:dump|scratch|notes|output)(?:\.|$)|\.tmp$/i;
export const PATCH_PATH_RE: RegExp = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/gm;
export const PATCH_HEREDOC_RE: RegExp = /^\s*apply_patch\s*<<\s*(['"]?)(\w+)\1[ \t]*\n(?<patch>[\s\S]*?)\n\2\s*$/;
export const UUID_RE: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
