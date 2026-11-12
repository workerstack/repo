/** Vitest reporters for a gate run that also writes the JSON the skip report is read from. */
export const REPORT_REPORTERS: readonly string[] = ["--reporter=default", "--reporter=json"];

/** The flag that sends the JSON reporter's output to a file; the file follows. */
export const REPORT_OUTPUT_FLAG = "--outputFile.json=";

/** The file name of the JSON report inside the temp directory. */
export const REPORT_JSON_FILE = "vitest.json";

/** The prefix of the temp directory the JSON report is written to. */
export const REPORT_TEMP_PREFIX = "workerstack-ci-report-";

/** Test statuses that mean the test did not run. */
export const SKIPPED_STATUSES: readonly string[] = ["skipped", "pending", "todo"];

/** Separates a test file from the full test name in a skip id. */
export const ID_SEPARATOR = " > ";

/** A report file a test job uploads. */
export const REPORT_FILE: RegExp = /^ci-report-.*\.json$/;

/** Reports needed before a test can be said to be skipped on every OS. */
export const MIN_REPORTS = 2;
export const REPORT_SHAPE = "expected { os: string, skipped: string[] }";
