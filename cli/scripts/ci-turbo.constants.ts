/** What `repo ci` passes turbo: the tasks, its cache dir and how much of the tasks' logs to show. */
export const TURBO_ARGS: readonly string[] = [
  "run",
  "typecheck",
  "test",
  "--cache-dir=.turbo/cache",
  "--output-logs=errors-only",
];

/** The variable that turns the packages' coverage off. */
export const COVERAGE_ENV = "REPO_COVERAGE";

/** The variable that names the file each package's vitest writes its json report to, relative to the package. */
/** The value of the coverage variable that turns coverage off. */
export const COVERAGE_OFF = "0";

/** The value of the coverage variable that turns coverage on. */
export const COVERAGE_ON = "1";
export const REPORT_ENV = "REPO_VITEST_REPORT";
export const REPORT_RELATIVE = ".turbo/vitest-report.json";

/** The variable that hands each package's vitest the `i/n` slice of its test files to run. */
export const SHARD_ENV = "REPO_VITEST_SHARD";

/** The tasks and cached counts of turbo's summary. */
export const TASKS_LINE: RegExp = /^\s*Tasks:[ \t]+\d+ successful, (\d+) total$/m;
export const CACHED_LINE: RegExp = /^\s*Cached:[ \t]+(\d+) cached, \d+ total$/m;

/** The ids of the tasks that failed, as turbo's summary lists them. */
export const FAILED_LINE: RegExp = /^\s*Failed:[ \t]+(.+)$/m;
