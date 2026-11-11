/** The help column: each command name is padded to this width before its summary. */
export const HELP_PAD: number = 18;
/** Where the user's arguments start in `process.argv`, after the runtime and the script. */
export const ARGV_START: number = 2;

export const INIT_COMMAND: string = "init";
export const QUIT_CHOICE: string = "quit";
export const SKIP_GLOBALS_FLAG: string = "--skip-globals";
export const PACKS_FLAG: string = "--packs";
export const PACKS_PREFIX: string = "--packs=";
/** A value after `--packs` that starts with this is the next flag, not the list. */
export const FLAG_PREFIX: string = "--";
/** The flags that turn the prompts off; init never asks without a TTY either. */
export const YES_FLAGS: ReadonlySet<string> = /* @__PURE__ */ new Set(["--yes", "-y", "--non-interactive"]);
export const HELP_COMMANDS: readonly string[] = ["help", "--help", "-h"];
export const VERSION_COMMANDS: readonly string[] = ["version", "--version", "-v"];

/** The TTY menu, in order; `init` is the default choice. */
export const MENU_OPTIONS: readonly { value: string; label: string }[] = [
  { label: "init", value: "init" },
  { label: "check", value: "check" },
  { label: "yolo", value: "yolo" },
  { label: "purge-mcps", value: "purge-mcps" },
  { label: "doctor", value: "doctor" },
  { label: "clean", value: "clean" },
  { label: "setup", value: "setup" },
  { label: "tasks", value: "tasks" },
  { label: "help", value: "help" },
  { label: "quit", value: "quit" },
];
export const MENU_MESSAGE: string = "Command";

/** The help text's head; the command list follows it. */
export const USAGE_HEAD: string = "Usage: repo [command]\n\nDefault (no command): TTY menu; else init — full setup\n";

/** The help rows before the registry's commands, each a name and its summary. */
export const USAGE_BUILTINS: readonly (readonly [string, string])[] = [
  [
    "init",
    `Full setup: write workerstack.config.ts and package.json, bun install (whose postinstall runs repo sync), \
repo yolo`,
  ],
  [
    "check",
    `Tsconfig bases, manifests, disable comments, lint.skip entries, generated files current, \
lint within .repo/lint-baseline.json, knip, actionlint on workflows, and floors, known failures and the baseline \
against main`,
  ],
  [
    "sync",
    "Write the committed generated files from workerstack.config.ts (--check: report drift; --postinstall: never fail)",
  ],
  ["map [dir]", "Code-only folder map (git-tracked, no files); dir for depth"],
];

/** The help rows after the hooks' row. */
export const USAGE_TAIL_ROWS: readonly (readonly [string, string])[] = [
  ["help", "Show this help"],
  ["version", "Print package version"],
];

/** The help text's flags section. */
export const USAGE_FLAGS: string = `Flags:
  --skip-globals     Skip repo yolo (otherwise init always runs it)
  --yes, -y          Non-interactive
  --non-interactive  Same as --yes
  --packs <list>     init: skill packs written as agents.skills into a new config: \
google-workspace,listen,speak,clasp or none
`;
