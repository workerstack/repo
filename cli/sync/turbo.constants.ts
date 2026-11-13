import { CONFIG_FILE } from "../config.constants.ts";
import type { TurboTask } from "../turbo-config.ts";

export const TURBO_CONFIG_PATH: string = "turbo.json";

/** The directory turbo keeps its cache and the skip report in; git ignores it under the pack. */
export const TURBO_DIR: string = ".turbo/";
export const TURBO_SCHEMA_URL: string = "https://turborepo.com/schema.json";
export const TURBO_JSON_INDENT = 2;

/** The files whose change reruns every task. */
export const GLOBAL_DEPENDENCIES: readonly string[] = ["bun.lock", "package.json", CONFIG_FILE];
export const TYPECHECK_TASK: TurboTask = { outputs: [] };

/**
 * The test task: coverage and the skip report are its outputs, and the variables that shape them its cache key, the
 * shard among them so one slice never replays another's run.
 */
export const TEST_TASK: TurboTask = {
  env: ["REPO_COVERAGE", "REPO_VITEST_REPORT", "REPO_VITEST_SHARD"],
  outputs: ["coverage/**", ".turbo/vitest-report.json"],
};

export const TURBO_REFUSAL: string = `${TURBO_CONFIG_PATH} is hand-written; delete it so repo sync can own it, \
and move its tasks to turbo.tasks`;
