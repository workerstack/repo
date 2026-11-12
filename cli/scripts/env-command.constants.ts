/** What `bun repo env` prints, the verbs and flags it takes, and its exit codes. */
export const ENV_SUMMARY =
  "Seal, list, read and hand out defineEnv values (init, set, get, ls, run, export, key, migrate)";

export const USAGE: string =
  "usage: bun repo env init | set KEY --scope <global|local|dev|prod> [--plain] [--file f] | " +
  "get KEY --scope s [--reveal] | ls | run --scope s -- cmd | export --scope s --format dotenv | " +
  "key import | key ci [--dry-run] | migrate [--dry-run]";

export const PREFIX = "repo env: ";
export const EXIT_OK = 0;

/** A refusal or a failed step, named on one line. */
export const EXIT_FAILED = 1;

/** A bad verb, flag or argument. */
export const EXIT_USAGE = 4;

/** The blocks a value is written to and read from: global, and the three scopes. */
export const SCOPES: readonly string[] = ["global", "local", "dev", "prod"];

/** A key as an env block names it: an identifier, so it needs no quotes and reads as `env.KEY`. */
export const KEY_NAME: Readonly<RegExp> = /^[A-Za-z_]\w*$/u;

/** The one export format. */
export const DOTENV = "dotenv";

/** What ends the flags of `run` and starts the command. */
export const COMMAND_START = "--";

/** A masked value shows this many leading characters, and none when it is shorter than MASK_MIN. */
export const MASK_SHOWN = 10;
export const MASK_MIN = 12;
export const MASK_TAIL = "…••••";
export const MASK_ALL = "••••";

/** The recipient as a line shows it: this many leading characters, then `…`. */
export const RECIPIENT_SHOWN = 6;

/** What a key file's identity is checked against: a probe sealed for the recipient, opened by the identity. */
export const PROBE = "workerstack env probe";

/** The CI secret `key ci` sets and the gh call that sets it. */
export const GH_SECRET: readonly string[] = ["secret", "set", "WORKERSTACK_ENV_KEY"];

/** The import that holds `sealed`, added to an env file that seals its first value. */
export const ENV_MODULE = "@workerstack/repo/env";
export const SEALED_NAME = "sealed";

/** What `migrate` rewrites: the old call, its secret marker and helpers, a config's parent key, and the manifest. */
export const OLD_CALL = "createScriptEnv";
export const SECRET_CALL = "secret";
export const KEYS_OF = "secretKeysOf";
export const UNWRAP = "unwrapSecrets";
export const PARENT_KEY = "parent";
export const PACKAGE_MANIFEST = "package.json";
export const DRY_RUN = "--dry-run";

/** How a migrate import map names a namespace import, in place of the name it takes. */
export const NAMESPACE = "*";

/** What an isolated config's name adds to its binding's, and the type an isolated seal is cast to. */
export const CONFIG_SUFFIX = "Config";
export const FIRST_SUFFIX = 2;
export const SEALED_TYPE = "Sealed";

/** What the migrate parity child puts before its one line of hashes, and how long it may run. */
export const PARITY_SENTINEL = "repo-env-parity:";
export const PARITY_TIMEOUT_MS = 60_000;
export const MS_PER_SECOND = 1000;

/** The exit codes of a migrate cut short by SIGINT or SIGTERM, after its files are restored. */
export const SIGNAL_EXITS: readonly (readonly ["SIGINT" | "SIGTERM", number])[] = [
  ["SIGINT", 130],
  ["SIGTERM", 143],
];

/** Where a path starts on a `git status --porcelain` line, after the two status letters and a space. */
export const STATUS_WIDTH = 3;

/** The brands a loaded env file's values carry, registered so any copy of the library shares them. */
export const LAYERS_SYMBOL = "@workerstack/repo/env.layers";
export const SEALED_SYMBOL = "@workerstack/repo/env.sealed";

/** Spacing between `ls` columns. */
export const COLUMN_GAP = "  ";
export const NONE = "-";
export const JSON_INDENT = 2;

/** The mode of a key file and of its folder. */
export const KEY_MODE = 0o600;
export const KEY_DIR_MODE = 0o700;

/** The index `at` and `indexOf` use for the last item and for no match. */
export const LAST = -1;
export const NOT_FOUND = -1;

/** The verbs, as argv names them. */
export const VERB_INIT = "init";
export const VERB_KEY = "key";
export const VERB_IMPORT = "import";
export const VERB_CI = "ci";
export const VERB_SET = "set";

/** The one trailing newline a piped value drops. */
export const TRAILING_NEWLINE: Readonly<RegExp> = /\r?\n$/u;

/** The dotenv quotes, and the characters that decide which of them can hold a value. */
export const SINGLE = "'";
export const DOUBLE = '"';
export const BACKTICK = "`";
export const BACKSLASH = "\\";
export const CR = "\r";
export const DOLLAR = "$";
