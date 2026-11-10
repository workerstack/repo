/**
 * `repo coverage`: runs the suite with coverage and writes each measured file's statements, branches, functions and
 * lines, floored to integers, to the `coverage.floors` file (`coverage-floors.json`). The preset applies them as
 * per-file thresholds. A floor only rises: a measurement below one fails and writes nothing.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { CONFIG_FILE, findRoot, loadConfig } from "./config.ts";
import { CARGO_PATH } from "./sync/rust.constants.ts";
import { JSON_INDENT, TOTAL_KEY } from "./coverage.constants.ts";
import { childEnv } from "./env.ts";
import { NESTED_VITEST_FLAGS } from "./nested-vitest-flags.ts";
import { sortedJsonValue } from "./scripts/json-keys.ts";
import { captureBun, captureTool } from "./scripts/lint.ts";
import { type CargoRun, runCargo } from "./rust/clippy.ts";
import { type Floors, readFloorsFile } from "./rust/floors.ts";
import { rustCoverage } from "./rust/rust-coverage.ts";

const METRICS = ["statements", "branches", "functions", "lines"] as const;
type Metric = (typeof METRICS)[number];
type Summary = Record<string, Record<Metric, { pct: number }>>;
/** The floors of each measured file, by metric: TypeScript and Rust rows alike. */
type Rows = Record<string, Record<string, number>>;

const SUMMARY_FILE = "coverage-summary.json";
const TEMP_PREFIX = "workerstack-cov-run-";
const FAILED = 1;
const PASSED = 0;

/** A comparison of the measurement with the old floors: what to write, what rose, what would drop. */
type Comparison = { next: Rows; raised: string[]; drops: string[] };

/** The TypeScript run: the summary, or none when there was nothing to run; not ok when a test failed. */
type Measured = { ok: true; summary: Summary | null } | { ok: false };

function write(stream: NodeJS.WriteStream, lines: readonly string[]): void {
  stream.write(`${lines.join("\n")}\n`);
}

/** Whether vitest resolves from `root`; a repo without it has no TypeScript tests to measure. */
function hasVitest(root: string): boolean {
  try {
    createRequire(path.join(root, "x.js")).resolve("vitest/package.json");
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the suite in `root` with thresholds off, so a floor miss cannot fail the run, and a `json-summary` report in
 * a temp dir that is removed after. No vitest installed means no summary, which is no failure; vitest writes the report even with no tests. A failing test prints vitest's own output and its own line.
 */
function measure(root: string): Measured {
  if (!hasVitest(root)) return { ok: true, summary: null };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  try {
    const flags = ["--coverage", "--coverage.thresholds=false", "--coverage.reporter=json-summary"];
    const args = [
      "--bun",
      "vitest",
      "run",
      "--passWithNoTests",
      ...NESTED_VITEST_FLAGS,
      ...flags,
      `--coverage.reportsDirectory=${dir}`,
    ];
    const ran = captureBun(args, root, childEnv());
    if (ran.code === PASSED) {
      const summary: unknown = JSON.parse(fs.readFileSync(path.join(dir, SUMMARY_FILE), "utf8"));
      return { ok: true, summary: summary /* vitest writes the json-summary shape */ as Summary };
    }
    process.stderr.write(ran.stdout + ran.stderr);
    write(process.stderr, ["coverage: the tests failed; fix them before raising floors"]);
    return { ok: false };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The TypeScript summary as floored rows keyed by root-relative POSIX path. */
function tsRows(root: string, summary: Summary): Rows {
  const rows: Rows = {};
  for (const [abs, metrics] of Object.entries(summary)) {
    if (abs === TOTAL_KEY) continue;
    const rel = path.relative(root, abs).split(path.sep).join("/");
    rows[rel] = Object.fromEntries(METRICS.map((key) => [key, Math.floor(metrics[key].pct)]));
  }
  return rows;
}

/** Each measured file's floors against `old`: the new floors, the lines for a raise, the lines for a drop. */
function compare(rows: Rows, old: Floors): Comparison {
  const result: Comparison = { next: rows, raised: [], drops: [] };
  for (const [rel, floor] of Object.entries(rows)) {
    const before: Record<string, number | undefined> | undefined = old[rel];
    for (const [key, now] of Object.entries(floor)) {
      const was = before?.[key];
      if (was !== undefined && now < was) {
        result.drops.push(`coverage: ${rel} ${key} would drop ${was} → ${now}; restore the tests or keep the floor`);
      } else if (was !== now) {
        result.raised.push(`${rel} ${key} ${was ?? "new"} → ${now}`);
      }
    }
  }
  return result;
}

/** Writes `floors` to `file` with every key sorted by code unit, then formats it with `repo fmt`'s tool; false, after printing why, if that fails. */
export function writeFloors(root: string, file: string, floors: Rows): boolean {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, sortedJsonValue(floors, JSON_INDENT));
  const formatted = captureTool("oxfmt", [file], root);
  if (formatted.code === PASSED) return true;
  process.stderr.write(formatted.stdout + formatted.stderr);
  write(process.stderr, [`coverage: could not format ${file}`]);
  return false;
}

/** The repo root and its floors path, or the lines that say why there is none. */
async function locate(cwd: string): Promise<{ root: string; floors: string } | string[]> {
  const root = findRoot(cwd);
  if (root === null) return [`repo coverage: no ${CONFIG_FILE} in ${cwd} or any parent; run \`bun repo init\``];
  const loaded = await loadConfig(root);
  if (!loaded.ok) return loaded.errors.map((line) => `repo coverage: ${line}`);
  return { root, floors: loaded.config.coverage.floors };
}

/** The Rust rows of a repo with a root Cargo.toml, none without one; null, after printing why, when the tests failed. */
function rustRows(root: string, run: CargoRun): Rows | null {
  if (!fs.existsSync(path.join(root, CARGO_PATH))) return {};
  const measured = rustCoverage(fs.realpathSync(root), run);
  if (measured.ok) return measured.value;
  write(process.stderr, [...measured.errors, "coverage: the Rust tests failed; fix them before raising floors"]);
  return null;
}

/** The floors file at `file`, or none, after printing why, when it cannot be read. */
function oldFloors(file: string): Floors | null {
  try {
    return readFloorsFile(file);
  } catch (error) {
    write(process.stderr, [`coverage: ${(error /* readFloorsFile throws Errors */ as Error).message}`]);
    return null;
  }
}

export async function main(_argv: string[], run: CargoRun = runCargo): Promise<number> {
  const located = await locate(process.cwd());
  if (Array.isArray(located)) {
    write(process.stderr, located);
    return FAILED;
  }
  const { root, floors } = located;
  const old = oldFloors(path.join(root, floors));
  if (old === null) return FAILED;
  const measured = measure(root);
  if (!measured.ok) return FAILED;
  const rust = rustRows(root, run);
  if (rust === null) return FAILED;
  const ts = measured.summary === null ? {} : tsRows(fs.realpathSync(root), measured.summary);
  const { next, raised, drops } = compare({ ...ts, ...rust }, old);
  if (drops.length > 0) {
    write(process.stderr, drops);
    return FAILED;
  }
  if (!writeFloors(root, floors, next)) return FAILED;
  write(process.stdout, [...raised, `wrote ${floors}`]);
  return PASSED;
}
