/**
 * `repo ci times <dir>`: merges the `durations` of the `ci-report-*.json` files of the test jobs into the committed
 * table `.repo/test-times.json`, `{ "<platform>": { "<path>": ms } }`, which the shard sequencer splits files by.
 */
import fs from "node:fs";
import path from "node:path";

import { findRoot, missingConfig } from "../config.ts";
import { readReports, sortedByKey, type Report, type ReportWords, type SkipsIo } from "./ci-skips.ts";
import { TIMES_FILE, TIMES_INDENT } from "./ci.constants.ts";

export type TimesTable = Record<string, Record<string, number>>;

const TIMES_WORDS: ReportWords = {
  bad: (shown, reason) => `${shown}: ${reason}`,
  empty: (dir) => `no ci-report-*.json in ${dir}`,
  missing: (dir) => `no ci-report-*.json in ${dir}`,
};

/** The durations of every report per `os`, the largest of a file's durations winning, keys sorted. */
function mergeTimes(reports: Report[]): TimesTable {
  const merged = new Map<string, Map<string, number>>();

  for (const { os, durations } of reports) {
    const files = merged.get(os) ?? new Map<string, number>();

    for (const [file, ms] of Object.entries(durations ?? {})) files.set(file, Math.max(files.get(file) ?? ms, ms));
    merged.set(os, files);
  }

  return Object.fromEntries(
    sortedByKey([...merged]).map(([os, files]) => [os, Object.fromEntries(sortedByKey([...files]))]),
  );
}

/** `repo ci times <dir>`: writes the table at the repo root; 1, with the reason on stderr, when it cannot. */
export function timesMain(dir: string, io: SkipsIo): number {
  function fail(lines: string[]): number {
    for (const line of lines) io.stderr(`repo ci times: ${line}\n`);

    return 1;
  }

  const root = findRoot(io.cwd);

  if (root === null) return fail([missingConfig(io.cwd)]);
  const read = readReports(dir, io.cwd, TIMES_WORDS);

  if ("failures" in read) return fail(read.failures);
  const table = mergeTimes(read.reports);
  fs.mkdirSync(path.dirname(path.join(root, TIMES_FILE)), { recursive: true });
  fs.writeFileSync(path.join(root, TIMES_FILE), `${JSON.stringify(table, null, TIMES_INDENT)}\n`);
  const counts = Object.entries(table).map(([os, files]) => `${os} ${Object.keys(files).length} files`);
  io.stdout(`repo ci times: wrote ${TIMES_FILE} (${counts.join(", ")})\n`);

  return 0;
}
