import { FIXTURES_DIR } from "../cli/fixtures.constants.ts";

/** The script's name, as its output line starts. */
export const NAME = "capture-tree-goldens";

/** The fixtures dir under the repo root, and the three dirs in it. */
export const FIXTURES: readonly string[] = ["cli", "sync", FIXTURES_DIR];
export const CONSUMER = "consumer";
export const STOCK = "consumer-stock";
export const GOLDEN = "golden";

/** Committed in every workspace and not a generated tree file, so the goldens leave it out. */
export const TASKS_REL = ".vscode/tasks.json";
export const TEMP_PREFIX = "workerstack-golden-";
export const WINDOWS = "win32";
