import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import type { Result } from "../scripts/lint-baseline.ts";
import { quote } from "./cargo-tools.ts";
import { MISSING_CARGO } from "./clippy.constants.ts";
import type { CargoRun } from "./clippy.ts";
import type { Floors, RustFloor } from "./floors.ts";
import { COVERAGE_ARGS, FLOOR_HELP, REPORT_FILE, RUST_METRICS, TEMP_PREFIX } from "./rust-coverage.constants.ts";

/** The shape of the llvm-cov export this reads, built once per run so the module runs no code. */
function schema() {
  const metric = z.object({ percent: z.number() });
  const file = z.object({
    filename: z.string(),
    summary: z.object({ functions: metric, lines: metric, regions: metric }),
  });
  return z.object({ data: z.tuple([z.object({ files: z.array(file) })]).rest(z.unknown()) });
}

/** A native path as a POSIX one, with no trailing slash. */
const posix = (file: string): string => file.replaceAll("\\", "/").replace(/\/+$/, "");

/** The root-relative POSIX path of `filename` under any of `roots`, or null when it is outside all of them. */
function relative(filename: string, roots: readonly string[]): string | null {
  const name = posix(filename);
  const root = roots.find((candidate) => name.startsWith(`${candidate}/`));
  return root === undefined ? null : name.slice(root.length + 1);
}

/** The root as the report may spell it: as given, and with its symlinks resolved. */
function rootsOf(root: string): string[] {
  const real = fs.existsSync(root) ? fs.realpathSync(root) : root;
  return [...new Set([posix(root), posix(real)])];
}

/** The report in `text` as rows, or why it cannot be read. */
function parse(text: string, root: string): Result<Record<string, RustFloor>> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { errors: [`cargo llvm-cov wrote a report that is not JSON: ${quote(text)}`], ok: false };
  }
  const report = schema().safeParse(json);
  if (!report.success) return { errors: [`cargo llvm-cov wrote a report repo cannot read: ${quote(text)}`], ok: false };
  const roots = rootsOf(root);
  const rows: Record<string, RustFloor> = {};
  for (const { filename, summary } of report.data.data[0].files) {
    const rel = relative(filename, roots);
    if (rel === null) continue;
    const floor = (percent: number): number => Math.floor(percent);
    rows[rel] = {
      // Key order is the report's row order: lines first, as for TypeScript, then the Rust metrics.
      lines: floor(summary.lines.percent),

      functions: floor(summary.functions.percent),
      regions: floor(summary.regions.percent),
    };
  }
  return { ok: true, value: rows };
}

/**
 * The per-file lines, functions and regions percents (floored) of the Rust tests under `cargo llvm-cov nextest` at
 * `root`, keyed by root-relative POSIX path. A failing test, a missing cargo and a report repo cannot read are errors:
 * nothing was measured.
 */
export function rustCoverage(root: string, run: CargoRun): Result<Record<string, RustFloor>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  try {
    const output = path.join(dir, REPORT_FILE);
    const result = run(root, [...COVERAGE_ARGS, output]);
    if (result.missing) return { errors: [MISSING_CARGO], ok: false };
    if (result.status !== 0) {
      const said = `${result.stdout}${result.stderr}`.trim();
      return { errors: [`cargo llvm-cov exited ${result.status}:\n${said}`], ok: false };
    }
    if (!fs.existsSync(output)) return { errors: ["cargo llvm-cov wrote no report repo can read"], ok: false };
    return parse(fs.readFileSync(output, "utf8"), root);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

/** One line per Rust metric of `rows` below its floor in `floors`; a file with no Rust floor has none. */
export function rustFloorProblems(rows: Readonly<Record<string, RustFloor>>, floors: Floors): string[] {
  const problems: string[] = [];
  for (const [rel, row] of Object.entries(rows)) {
    const floor = floors[rel];
    if (floor === undefined || !("regions" in floor)) continue;
    for (const key of RUST_METRICS) {
      if (row[key] < floor[key]) {
        problems.push(`rust coverage: ${rel} ${key} ${row[key]} is below its floor ${floor[key]}; ${FLOOR_HELP}`);
      }
    }
  }
  return problems;
}
