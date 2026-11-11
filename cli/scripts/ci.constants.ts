/** A tsconfig file name in the root or a package directory. */
export const TSCONFIG_FILE: RegExp = /^tsconfig.*\.json$/;
/** A path segment under which a package is a fixture or an install, never typechecked. */
export const SKIPPED_SEGMENTS: readonly string[] = ["fixtures", `node_modules`];
/** tsc's flags before the build info file: incremental, so a rerun reads what the last one kept. */
export const TSC_ARGS: readonly string[] = ["--noEmit", "--incremental", "--tsBuildInfoFile"];
/** Where each config's build info goes, relative to the root, so CI can cache it between runs. */
export const TSBUILDINFO_DIR: string = ".tmp/repo/tsbuildinfo";
export const TSBUILDINFO_EXTENSION: string = ".tsbuildinfo";
/** tsc's flag before the config it checks. */
export const TSC_PROJECT_FLAG: string = "-p";
/** vitest's subcommand for one run, and its flag that measures coverage. */
export const VITEST_RUN_COMMAND: string = "run";
export const VITEST_COVERAGE_FLAG: string = "--coverage";
export const VITEST_RUN_ARGS: readonly string[] = ["run", "--coverage"];
/** The same run without coverage, so no per-file floor applies. */
export const VITEST_RUN_NO_COVERAGE_ARGS: readonly string[] = ["run"];
export const SUMMARY_SEPARATOR = " · ";
export const MS_PER_SECOND = 1000;
export const USAGE: string =
  "use repo ci [--no-coverage] [--report <file>] [--shard <i>/<n>], repo ci skips <dir>, repo ci times <dir>, " +
  "repo ci merge <dir> or repo ci wait [<branch>] " +
  "(exits 0 passed, 1 failed, 2 superseded, 3 nothing to wait on, 4 error)";
export const REPORT_FLAG = "--report";
export const NO_COVERAGE_FLAG = "--no-coverage";
export const SHARD_FLAG = "--shard";
/** `--shard`'s value: two whole numbers, the slice and the count. */
export const SHARD_PATTERN: RegExp = /^(\d+)\/(\d+)$/;
/** vitest's flag for the slice of the test files to run. */
export const VITEST_SHARD_FLAG: string = "--shard=";
/** vitest's flags for a shard's blob: the reporter, and the file flag whose value is the blob path. */
export const BLOB_REPORTER_FLAG: string = "--reporter=blob";
export const BLOB_OUTPUT_FLAG: string = "--outputFile.blob=";
/** The default reporter, which a `--reporter` flag would otherwise replace. */
export const DEFAULT_REPORTER_FLAG: string = "--reporter=default";
/** Where the shards' blobs go, relative to the root. */
export const BLOB_DIR: string = ".tmp/repo/blob";
/** A shard's flag that leaves the floors to the merged run. */
export const NO_THRESHOLDS_FLAG: string = "--coverage.thresholds=false";
export const SHARD_WITH_FLOORS_NOTE: string = "floors left to repo ci merge";
export const SHARD_NEEDS_ROOT_RUN: string =
  "--shard with coverage needs one root vitest run; under the workspace pack pass --no-coverage";
export const SKIPS_COMMAND = "skips";
export const TIMES_COMMAND = "times";
/** The committed table of test file times, relative to the root. */
/** The spaces `.repo/test-times.json` is indented by. */
export const TIMES_INDENT = 2;
export const TIMES_FILE = ".repo/test-times.json";
export const MERGE_COMMAND = "merge";
export const WAIT_COMMAND = "wait";
export const WAIT_MANY = "wait takes at most one branch";
/** The exit code of a refused `repo ci wait a b`. */
export const EXIT_WAIT_MANY = 2;
/** The `code` of a spawn error for a command that is not on PATH. */
export const NOT_FOUND_CODE = "ENOENT";
/** Added to the vitest run of a repo with a root Cargo.toml, whose tests may all be Rust ones. */
export const PASS_WITH_NO_TESTS_FLAG: string = "--passWithNoTests";
/** The label of the tests gate when a Rust repo has no vitest test files. */
export const NO_TEST_FILES_LABEL: string = "tests skipped (no test files)";
/** A shard's blob file name, `blob-<i>-<n>.json`, as `--outputFile.blob` wrote it. */
export const BLOB_FILE: RegExp = /^blob-(?<index>\d+)-(?<count>\d+)\.json$/;
/** Any blob file, whatever its numbers. */
export const BLOB_ANY_FILE: RegExp = /^blob-.*\.json$/;
/** vitest's flag to merge the blobs in the directory that follows it. */
export const MERGE_REPORTS_FLAG: string = "--merge-reports=";
