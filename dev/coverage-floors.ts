#!/usr/bin/env bun
/**
 * Writes `cli/scripts/coverage-floors.json`: each `cli/scripts` file's statements, branches, functions and lines
 * from the last `vitest run --coverage` (`coverage/coverage-summary.json`), floored to integers. `vitest.config.ts`
 * applies them as per-file thresholds. A floor only rises: a measurement below one fails and writes nothing.
 *
 * Run: `bun dev/coverage-floors.ts` from the repo root, after `bunx vitest run --coverage`.
 */
import fs from "node:fs";
import path from "node:path";

export const SUMMARY_REL = "coverage/coverage-summary.json";
export const FLOORS_REL = "cli/scripts/coverage-floors.json";
const SCRIPTS_REL = "cli/scripts/";
const METRICS = ["statements", "branches", "functions", "lines"] as const;

type Floor = Record<(typeof METRICS)[number], number>;
type Floors = Record<string, Floor>;
type Summary = Record<string, Record<(typeof METRICS)[number], { pct: number }>>;

export type FloorsResult = { ok: true; raised: string[] } | { ok: false; errors: string[] };

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Measure, compare against the committed floors under `root`, and write them when none drops. */
export function writeFloors(root: string): FloorsResult {
  const summary = readJson<Summary>(path.join(root, SUMMARY_REL));
  if (summary === null) return { ok: false, errors: [`no ${SUMMARY_REL}: run vitest run --coverage first`] };
  const old = readJson<Floors>(path.join(root, FLOORS_REL)) ?? {};
  const next: Floors = {};
  const raised: string[] = [];
  const errors: string[] = [];
  for (const [abs, metrics] of Object.entries(summary)) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (!rel.startsWith(SCRIPTS_REL) || !rel.endsWith(".ts")) continue;
    const floor = {} as Floor;
    for (const key of METRICS) {
      const now = Math.floor(metrics[key].pct);
      const was = old[rel]?.[key];
      if (was !== undefined && now < was) errors.push(`coverage floor for ${path.posix.basename(rel)} ${key} would drop ${was} → ${now}`);
      else if (was !== now) raised.push(`${rel} ${key} ${was ?? "new"} → ${now}`);
      floor[key] = now;
    }
    next[rel] = floor;
  }
  if (errors.length > 0) return { ok: false, errors };
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(path.join(root, FLOORS_REL), `${JSON.stringify(sorted, null, 2)}\n`);
  return { ok: true, raised };
}

if (import.meta.main) {
  const result = writeFloors(process.cwd());
  if (!result.ok) {
    process.stderr.write(`${result.errors.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write([...result.raised, `wrote ${FLOORS_REL}`].join("\n") + "\n");
}
