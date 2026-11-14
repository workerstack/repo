/** Config every git a test runs gets, so no detached maintenance child outlives the test. */
export const QUIET_GIT: ReadonlyArray<readonly [string, string]> = [
  ["maintenance.auto", "false"],
  ["gc.auto", "0"],
  ["core.fsmonitor", "false"],
];

export const GIT_CONFIG_COUNT = "GIT_CONFIG_COUNT";
export const GIT_CONFIG_GLOBAL = "GIT_CONFIG_GLOBAL";
export const GIT_CONFIG_SYSTEM = "GIT_CONFIG_SYSTEM";

/** The system git config of Linux and macOS test runs: `core.autocrlf=true`, as the Windows runner's git sets. */
export const AUTOCRLF_CONFIG = "autocrlf.gitconfig";
export const GIT_CONFIG_KEY = "GIT_CONFIG_KEY_";
export const GIT_CONFIG_VALUE = "GIT_CONFIG_VALUE_";
export const BUN_CACHE_VAR = "BUN_RUNTIME_TRANSPILER_CACHE_PATH";

/** The project dirs host shells export; a test resolves its own roots, so they never reach it. */
export const HOST_PROJECT_VARS: readonly string[] = ["CLAUDE_PROJECT_DIR", "GROK_WORKSPACE_ROOT"];
