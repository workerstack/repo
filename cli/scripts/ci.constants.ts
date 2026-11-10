/** A tsconfig file name in the root or a package directory. */
export const TSCONFIG_FILE: RegExp = /^tsconfig.*\.json$/;
/** A path segment under which a package is a fixture or an install, never typechecked. */
export const SKIPPED_SEGMENTS: readonly string[] = ["fixtures", `${"node"}_modules`];
export const TSC_ARGS: readonly string[] = ["--noEmit", "-p"];
export const VITEST_RUN_ARGS: readonly string[] = ["run", "--coverage"];
/** The same run without coverage, so no per-file floor applies. */
export const VITEST_RUN_NO_COVERAGE_ARGS: readonly string[] = ["run"];
export const SUMMARY_SEPARATOR = " · ";
export const MS_PER_SECOND = 1000;
export const USAGE = "use repo ci [--no-coverage] [--report <file>], repo ci skips <dir> or repo ci wait";
export const REPORT_FLAG = "--report";
export const NO_COVERAGE_FLAG = "--no-coverage";
export const SKIPS_COMMAND = "skips";
export const WAIT_COMMAND = "wait";
/** The `code` of a spawn error for a command that is not on PATH. */
export const NOT_FOUND_CODE = "ENOENT";
/** Added to the vitest run of a repo with a root Cargo.toml, whose tests may all be Rust ones. */
export const PASS_WITH_NO_TESTS_FLAG: string = "--passWithNoTests";
/** The label of the tests gate when a Rust repo has no vitest test files. */
export const NO_TEST_FILES_LABEL: string = "tests skipped (no test files)";
