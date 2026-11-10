/**
 * `repo coverage`: runs the suite with coverage and writes each measured file's statements, branches, functions and
 * lines, floored to integers, to the `coverage.floors` file (`coverage-floors.json`). The preset applies them as
 * per-file thresholds. A floor only rises: a measurement below one fails and writes nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_FILE, findRoot, loadConfig } from "./config.ts";
import { JSON_INDENT, TOTAL_KEY } from "./coverage.constants.ts";
import { childEnv } from "./env.ts";
import { NESTED_VITEST_FLAGS } from "./nested-vitest-flags.ts";
import { sortedJsonValue } from "./scripts/json-keys.ts";
import { captureBun, captureTool } from "./scripts/lint.ts";

const METRICS = ["statements", "branches", "functions", "lines"] as const;
type Metric = (typeof METRICS)[number];
type Floor = Record<Metric, number>;
type Floors = Record<string, Floor>;
type Summary = Record<string, Record<Metric, { pct: number }>>;

const SUMMARY_FILE = "coverage-summary.json";
const TEMP_PREFIX = "workerstack-cov-run-";
const FAILED = 1;
const PASSED = 0;

/** A comparison of the measurement with the old floors: what to write, what rose, what would drop. */
type Comparison = { next: Floors; raised: string[]; drops: string[] };

type Measured = { ok: true; summary: Summary } | { ok: false };

function write(stream: NodeJS.WriteStream, lines: readonly string[]): void {
  stream.write(`${lines.join("\n")}\n`);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) /* the caller names the shape the file holds */ as T;
  } catch {
    return null;
  }
}

/**
 * Runs the suite in `root` with thresholds off, so a floor miss cannot fail the run, and a `json-summary` report in
 * a temp dir that is removed after. A failing test prints vitest's own output and its own line.
 */
function measure(root: string): Measured {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  try {
    const flags = ["--coverage", "--coverage.thresholds=false", "--coverage.reporter=json-summary"];
    const args = ["--bun", "vitest", "run", ...NESTED_VITEST_FLAGS, ...flags, `--coverage.reportsDirectory=${dir}`];
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

/** Each measured file's floors against `old`: the new floors, the lines for a raise, the lines for a drop. */
function compare(root: string, summary: Summary, old: Floors): Comparison {
  const result: Comparison = { next: {}, raised: [], drops: [] };
  for (const [abs, metrics] of Object.entries(summary)) {
    if (abs === TOTAL_KEY) continue;
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const floor = {} /* filled for every metric below */ as Floor;
    for (const key of METRICS) {
      const now = Math.floor(metrics[key].pct);
      const was = old[rel]?.[key];
      if (was !== undefined && now < was) {
        result.drops.push(`coverage: ${rel} ${key} would drop ${was} → ${now}; restore the tests or keep the floor`);
      } else if (was !== now) {
        result.raised.push(`${rel} ${key} ${was ?? "new"} → ${now}`);
      }
      floor[key] = now;
    }
    result.next[rel] = floor;
  }
  return result;
}

/** Writes `floors` to `file` with every key sorted by code unit, then formats it with `repo fmt`'s tool; false, after printing why, if that fails. */
export function writeFloors(root: string, file: string, floors: Floors): boolean {
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

export async function main(_argv: string[]): Promise<number> {
  const located = await locate(process.cwd());
  if (Array.isArray(located)) {
    write(process.stderr, located);
    return FAILED;
  }
  const { root, floors } = located;
  const measured = measure(root);
  if (!measured.ok) return FAILED;
  const old = readJson<Floors>(path.join(root, floors)) ?? {};
  const { next, raised, drops } = compare(fs.realpathSync(root), measured.summary, old);
  if (drops.length > 0) {
    write(process.stderr, drops);
    return FAILED;
  }
  if (!writeFloors(root, floors, next)) return FAILED;
  write(process.stdout, [...raised, `wrote ${floors}`]);
  return PASSED;
}
