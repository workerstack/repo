/**
 * The skip report of `repo ci --report <file>` and the check of `repo ci skips <dir>`. Each OS's test job writes the
 * ids of the tests that did not run; a test skipped in every report runs in no CI job, which the check refuses.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ID_SEPARATOR, MIN_REPORTS, REPORT_FILE, REPORT_SHAPE, SKIPPED_STATUSES } from "./ci-skips.constants.ts";

/** Where relative paths start, and where lines go. */
export type SkipsIo = { cwd: string; stdout: (s: string) => void; stderr: (s: string) => void };
type Report = { os: string; skipped: string[] };

const vitestReport = () =>
  z.object({
    testResults: z.array(
      z.object({
        name: z.string(),
        assertionResults: z.array(z.object({ fullName: z.string(), status: z.string() })),
      }),
    ),
  });
const ciReport = () => z.object({ os: z.string().min(1), skipped: z.array(z.string()) });

const posix = (file: string) => file.replaceAll("\\", "/");

/** The ids of the tests vitest's JSON report says did not run, sorted and unique; the paths are root-relative posix. */
export function skippedIds(json: unknown, root: string): string[] {
  const parsed = vitestReport().safeParse(json);
  if (!parsed.success) return [];
  const ids = parsed.data.testResults.flatMap((file) =>
    file.assertionResults
      .filter((test) => SKIPPED_STATUSES.includes(test.status))
      .map((test) => `${path.posix.relative(posix(root), posix(file.name))}${ID_SEPARATOR}${test.fullName}`),
  );
  return [...new Set(ids)].toSorted();
}

/** Writes `file` from the JSON report at `jsonFile`; a report that was not written or read has no skips. */
export function writeReport(file: string, jsonFile: string, root: string): void {
  let json: unknown = null;
  try {
    json = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  } catch {
    json = null;
  }
  const report: Report = { os: process.platform, skipped: skippedIds(json, root) };
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
function readReport(file: string): { report: Report | null; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { report: null, reason: "not valid JSON" };
  }
  const parsed = ciReport().safeParse(json);
  return { report: parsed.success ? parsed.data : null, reason: REPORT_SHAPE };
}

/** Reads every report in `dir`; failures are the lines to print, one per problem. */
function readAll(dir: string, cwd: string): { reports: Report[] } | { failures: string[] } {
  const at = path.resolve(cwd, dir);
  let found: string[];
  try {
    found = reportFiles(at);
  } catch {
    return { failures: [`${dir} is not a directory; download the test jobs' reports into it first`] };
  }
  if (found.length === 0)
    return { failures: [`${dir} has no ci-report-*.json; download the test jobs' reports first`] };
  const read = found.map((rel) => ({ shown: `${dir}/${rel}`, got: readReport(path.join(at, rel)) }));
  const failures = read
    .filter(({ got }) => got.report === null)
    .map(({ shown, got }) => `${shown} is not a ci report: ${got.reason}`);
  if (failures.length > 0) return { failures };
  return { reports: read.map(({ got }) => got.report).filter((report): report is Report => report !== null) };
}

/** `repo ci skips <dir>`: fails each test skipped in every report; `dir` is shown as given. */
export function skipsMain(dir: string, io: SkipsIo): number {
  const read = readAll(dir, io.cwd);
  const fail = (lines: string[]) => {
    for (const line of lines) io.stderr(`repo ci skips: ${line}\n`);
    return 1;
  };
  if ("failures" in read) return fail(read.failures);
  const byOs = new Map<string, Set<string>>();
  for (const report of read.reports) {
    const ids = byOs.get(report.os) ?? new Set<string>();
    for (const id of report.skipped) ids.add(id);
    byOs.set(report.os, ids);
  }
  const oses = [...byOs.keys()].toSorted();
  if (oses.length < MIN_REPORTS) {
    return fail([`only ${oses.length} report (${oses.join(", ")}); every OS's test job must upload one`]);
  }
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
