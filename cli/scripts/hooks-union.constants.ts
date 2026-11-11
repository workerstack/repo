import type { HookName } from "./hook-command.ts";

/** The text every consumer script command starts with; `rootCmd` builds the rest. */
export const ROOT_PREFIX = 'd="${GROK_WORKSPACE_ROOT:-${CLAUDE_PROJECT_DIR:-.}}"; [ -e "$d/';

/** The consumer scripts the union wires, by file name under the consumer's `scripts/`. */
export const PULL_SCRIPT = "daily-pull-check.mjs";
export const RTK_SCRIPT = "rtk-check.mjs";
export const FLEET_SCRIPT = "daily-fleet-check.mjs";
export const BEHIND_SCRIPT = "check-behind.mjs";
export const VALIDATE_SCRIPT = "validate.mjs";
export const SIM_SCRIPT = "sim.mjs";

export const AUTORUN_NEEDLES: string[] = [
  PULL_SCRIPT,
  RTK_SCRIPT,
  FLEET_SCRIPT,
  BEHIND_SCRIPT,
  VALIDATE_SCRIPT,
  SIM_SCRIPT,
];
export const OWNED_HOOKS: readonly HookName[] = ["scrub-spawn-prompt", "gate-fat-tools"];

/** The consumer's git hooks dir, and the hooks it must hold once it exists. */
export const GIT_HOOKS_DIR = "scripts/git-hooks";
export const GIT_HOOKS: string[] = [
  "scripts/git-hooks/pre-commit",
  "scripts/git-hooks/pre-commit.mjs",
  "scripts/git-hooks/pre-push",
  "scripts/git-hooks/pre-push.mjs",
];

/** Claude and Codex's write tools for the consumer's PreToolUse check. */
export const PRE_WRITE_MATCHER = "Write|Edit";
export const POST_WRITE_MATCHER = "Write|Edit|write|search_replace";
/** Antigravity's write tools. Matchers the generator does not emit must use these names; it only translates its own. */
export const AGY_WRITE_MATCHER = "write_file|edit_file";
/** Cursor's write tool. Entries the generator does not emit must use its name; Cursor has no Edit tool. */
export const CURSOR_WRITE_MATCHER = "Write";

/** The seconds the folder map hook may run. */
export const MAP_TIMEOUT_S = 5;
/** The indent the union writes its JSON files with. */
export const JSON_INDENT = 2;
/** The key a hook entry holds its command under. */
export const COMMAND_KEY = "command";
/** The stock hooks source, which may hold the short `repo hook <name>` form. */
export const RULESYNC_ID = "rulesync";

/** The hook files the union writes, from the workspace root. */
export const CLAUDE_SETTINGS = ".claude/settings.json";
export const CODEX_HOOKS = ".codex/hooks.json";
export const AGENTS_HOOKS = ".agents/hooks.json";
export const CURSOR_HOOKS = ".cursor/hooks.json";

/** Hook files whose repo commands must be `hookCommand` and whose autorun commands must be `rootCmd` strings. */
export const COMMAND_FILES: [string, string][] = [
  ["claude", CLAUDE_SETTINGS],
  ["codex", CODEX_HOOKS],
  ["agents", AGENTS_HOOKS],
  ["cursor", CURSOR_HOOKS],
  [RULESYNC_ID, "agents/hooks.jsonc"],
  ["grok", ".grok/hooks/orchestrate-parent.json"],
  ["grok", ".grok/hooks/rtk.json"],
];
