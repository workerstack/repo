/** The names `repo coverage` reads from the coverage summary. */

/** The summary key holding the totals over every file, which is no file. */
export const TOTAL_KEY = "total";

/**
 * The default test and hook timeout of the measuring run, in milliseconds. It runs the whole suite at once,
 * instrumented, on whatever else the machine is doing, so the preset's 5s bound fails tests that pass; here a
 * timeout only has to catch a hang.
 */
export const COVERAGE_TIMEOUT_MS = 60_000;

/** The spaces the floors file is indented with. */
export const JSON_INDENT = 2;
