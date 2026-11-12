/**
 * The skip report of `repo ci --report <file>` and the check of `repo ci skips <dir>`. Each OS's test job writes the
 * ids of the tests that did not run; a test skipped in every report runs in no CI job, which the check refuses.
 */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { readJson, tryJson } from "../json.ts";
import { ID_SEPARATOR, MIN_REPORTS, REPORT_FILE, REPORT_EXPECTED, SKIPPED_STATUSES } from "./ci-skips.constants.ts";

/** Where relative paths start, and where lines go. */
export type SkipsIo = { cwd: string; stdout: (s: string) => void; stderr: (s: string) => void };

/** What a test job uploads; `durations` is absent from reports written before it was added. */
export type Report = { os: string; skipped: string[]; durations?: Record<string, number> | undefined };

function vitestReport() {
  return z.object({
    testResults: z.array(
      z.object({
        assertionResults: z.array(z.object({ fullName: z.string(), status: z.string() })),
        endTime: z.number().optional(),
        name: z.string(),
        startTime: z.number().optional(),
      }),
    ),
  });
}

type VitestReport = z.output<ReturnType<typeof vitestReport>>;

function ciReport() {
  return z.object({
    durations: z.record(z.string(), z.number()).optional(),
    os: z.string().min(1),
    skipped: z.array(z.string()),
  });
}

function posix(file: string) {
  return file.replaceAll("\\", "/");
}

/** The root-relative posix ids of the tests vitest's JSON report `text` says did not run, sorted and unique. */
export function skippedIds(text: string, root: string): string[] {
  return skippedOf(tryJson(vitestReport(), text), root);
}

function skippedOf(report: VitestReport | undefined, root: string): string[] {
  if (report === undefined) return [];

  const ids = report.testResults.flatMap((file) =>
    file.assertionResults
      .filter((test) => SKIPPED_STATUSES.includes(test.status))
      .map((test) => `${path.posix.relative(posix(root), posix(file.name))}${ID_SEPARATOR}${test.fullName}`),
  );

  return [...new Set(ids)].toSorted();
}

/** `entries` ordered by key, in code unit order like `toSorted()`, so no locale changes a committed file. */
export function sortedByKey<T>(entries: [string, T][]): [string, T][] {
  return entries.toSorted(([a], [b]) => Number(a > b) - Number(a < b));
}

/** The whole ms each test file took, by root-relative posix path, sorted; a file without both times has none. */
function durationsOf(report: VitestReport | undefined, root: string): Record<string, number> {
  if (report === undefined) return {};
  const ms = new Map<string, number>();

  for (const { name, startTime, endTime } of report.testResults) {
    if (startTime !== undefined && endTime !== undefined)
      ms.set(path.posix.relative(posix(root), posix(name)), Math.round(endTime - startTime));
  }

  return Object.fromEntries(sortedByKey([...ms]));
}

/** Writes `file` from the JSON report at `jsonFile`; a report that was not written or read has no skips. */
export function writeReport(file: string, jsonFile: string, root: string): void {
  let text = "";

  try {
    text = fs.readFileSync(jsonFile, "utf8");
  } catch {
    // An absent report has no skips.
  }

  const vitest = tryJson(vitestReport(), text);

  const report: Report = {
    durations: durationsOf(vitest, root),
    os: process.platform,
    skipped: skippedOf(vitest, root),
  };

  fs.writeFileSync(file, `${JSON.stringify(report)}\n`);
}

/** The `ci-report-*.json` files of `dir` and of its subdirectories, as paths relative to `dir`. */
function reportFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const nested = entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      fs
        .readdirSync(path.join(dir, entry.name), { withFileTypes: true })
        .filter((inner) => inner.isFile() && REPORT_FILE.test(inner.name))
        .map((inner) => `${entry.name}/${inner.name}`),
    );

  const top = entries.filter((entry) => entry.isFile() && REPORT_FILE.test(entry.name)).map((entry) => entry.name);

  return [...top, ...nested].toSorted();
}

/** The report in `file`, or null with why it is not one. */
function readReport(file: string) {
  let json: unknown;

  try {
    json = readJson(z.json(), fs.readFileSync(file, "utf8"));
  } catch {
    return { reason: "not valid JSON", report: null };
  }

  const parsed = ciReport().safeParse(json);

  return { reason: REPORT_EXPECTED, report: parsed.success ? parsed.data : null };
}

/** The lines that say why the reports of a directory cannot be read. */
export type ReportWords = {
  bad: (shown: string, reason: string) => string;
  empty: (dir: string) => string;
  missing: (dir: string) => string;
};

/** Reads every report in `dir`; failures are the lines to print, one per problem, worded by `say`. */
export function readReports(
  dir: string,
  cwd: string,
  say: ReportWords,
): { reports: Report[] } | { failures: string[] } {
  const at = path.resolve(cwd, dir);
  let found: string[];

  try {
    found = reportFiles(at);
  } catch {
    return { failures: [say.missing(dir)] };
  }

  if (found.length === 0) return { failures: [say.empty(dir)] };
  const read = found.map((rel) => ({ got: readReport(path.join(at, rel)), shown: `${dir}/${rel}` }));
  const failures = read.filter(({ got }) => got.report === null).map(({ shown, got }) => say.bad(shown, got.reason));

  if (failures.length > 0) return { failures };

  return { reports: read.map(({ got }) => got.report).filter((report): report is Report => report !== null) };
}

const SKIPS_WORDS: ReportWords = {
  bad: (shown, reason) => `${shown} is not a ci report: ${reason}`,
  empty: (dir) => `${dir} has no ci-report-*.json; download the test jobs' reports first`,
  missing: (dir) => `${dir} is not a directory; download the test jobs' reports into it first`,
};

/** `repo ci skips <dir>`: fails each test skipped in every report; `dir` is shown as given. */
export function skipsMain(dir: string, io: SkipsIo): number {
  const read = readReports(dir, io.cwd, SKIPS_WORDS);

  function fail(lines: string[]) {
    for (const line of lines) io.stderr(`repo ci skips: ${line}\n`);

    return 1;
  }

  if ("failures" in read) return fail(read.failures);
  const byOs = new Map<string, Set<string>>();

  for (const report of read.reports) {
    const ids = byOs.get(report.os) ?? new Set<string>();

    for (const id of report.skipped) ids.add(id);
    byOs.set(report.os, ids);
  }

  const oses = [...byOs.keys()].toSorted();

  if (oses.length < MIN_REPORTS)
    return fail([`only ${oses.length} report (${oses.join(", ")}); every OS's test job must upload one`]);

  const shared = [...new Set([...byOs.values()].flatMap((ids) => [...ids]))].filter((id) =>
    [...byOs.values()].every((ids) => ids.has(id)),
  );

  if (shared.length > 0) {
    return fail(
      shared
        .toSorted()
        .map((id) => `${id} is skipped on every OS (${oses.join(", ")}); make it run on one or delete it`),
    );
  }

  io.stdout(`ci skips: ${read.reports.length} reports (${oses.join(", ")}), no test skipped on all of them\n`);

  return 0;
}
