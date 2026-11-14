/** The prefix of the variables git hands a hook (GIT_DIR, GIT_INDEX_FILE, ...). */
export const GIT_ENV_PREFIX = "GIT_";

/** Env-config variables and the config files they name: they set config, not the repo, so a tool keeps them. */
export const GIT_CONFIG_ENV: RegExp = /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|GLOBAL|SYSTEM)$/;

/** Where oxlint's json report starts when a note ("No files found to lint.") precedes it: a line opening with `{`. */
export const REPORT_START: RegExp = /^\{/m;

/** The flag that makes `repo fmt` report instead of write. */
export const CHECK_FLAG = "--check";

/** The dir a package manager installs packages into. */
export const MODULES_DIR = "node_modules";

/** The spawn error code of a bin that is not on PATH. */
export const NOT_FOUND = "ENOENT";

/** bun fmt's flag that writes a `[fmt]` section into bunfig.toml, which `repo fmt` refuses. */
export const INIT_FLAG = "--init";

/** Why `repo fmt --init` is refused: sync owns bunfig.toml, and the layout lives in the oxfmt config. */
export const INIT_REFUSAL = "--init writes bunfig.toml, which repo sync owns; edit .oxfmtrc.jsonc";

/** The bun arguments that run its formatter, never a package.json `fmt` script of the same name. */
export const BUN_FMT_ARGS: readonly string[] = ["fmt", "--no-script"];
