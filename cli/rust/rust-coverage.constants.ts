/**
 * The cargo arguments before the report path: nextest under llvm-cov, locked, over the workspace, as a JSON summary.
 */
export const COVERAGE_ARGS: readonly string[] = [
  "llvm-cov",
  "nextest",
  "--locked",
  "--workspace",
  "--no-tests=warn",
  "--json",
  "--summary-only",
  "--output-path",
];
/** The prefix of the temp directory that holds the report. */
export const TEMP_PREFIX: string = "repo-llvm-cov-";
/** The name of the report file in that directory. */
export const REPORT_FILE: string = "summary.json";
/** The Rust metrics a floor holds, in the order a problem lists them. */
export const RUST_METRICS: readonly ("lines" | "functions" | "regions")[] = ["lines", "functions", "regions"];
/** What a person does about a metric below its floor. */
export const FLOOR_HELP: string = "add tests or restore the code";
