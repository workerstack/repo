/** The config both formatters read from a tree; sync writes it. */
export const CONFIG_FILE = ".oxfmtrc.jsonc";

/** The tools compared, in the order they run. */
export const TOOLS = ["oxfmt", "bun fmt"] as const;

/** Dirs whose files no formatter run reads and a copy should not carry. */
export const HEAVY_DIRS: readonly string[] = [
  ".git",
  ".tmp",
  ".turbo",
  ".worktrees",
  "coverage",
  "node_modules",
  "target",
];

/** The oxfmt config that lays a copy out unlike the tree's own. */
export const PERTURB_CONFIG = '{"printWidth":40,"useTabs":true}\n';

/** The same layout for bun fmt, which reads no config here. */
export const PERTURB_BUN_ARGS: readonly string[] = [
  "fmt",
  "--no-script",
  "--no-config",
  "--use-tabs",
  "--print-width=40",
];

/** What a person who gave a bad flag reads. */
export const USAGE = "usage: bun dev/fmt-parity.ts [dir...]";

/** The mode a copy gets: sync leaves its files read-only and the formatters must rewrite them. */
export const FILE_MODE = 0o644;

/** Where argv's own args start after the runtime and the script. */
export const ARGV_START = 2;

/** What a person reads when a tree has no config the formatters would apply. */
export const NO_CONFIG: string = `has no ${CONFIG_FILE}; run bun repo sync there first`;

/** What a person reads when git cannot say which files the formatters skip. */
export const NOT_GIT = "is not a git repo; its .gitignore decides what the formatters skip";
