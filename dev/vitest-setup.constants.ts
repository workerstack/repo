/** Config every git a test runs gets, so no detached maintenance child outlives the test. */
export const QUIET_GIT: ReadonlyArray<readonly [string, string]> = [
  ["maintenance.auto", "false"],
  ["gc.auto", "0"],
  ["core.fsmonitor", "false"],
];
export const GIT_CONFIG_COUNT = "GIT_CONFIG_COUNT";
export const GIT_CONFIG_KEY = "GIT_CONFIG_KEY_";
export const GIT_CONFIG_VALUE = "GIT_CONFIG_VALUE_";
export const BUN_CACHE_VAR = "BUN_RUNTIME_TRANSPILER_CACHE_PATH";
