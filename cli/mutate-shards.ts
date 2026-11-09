/** The shard reports in a dir: read, and judged to be one complete run. */
import path from "node:path";
import type { MutateDeps } from "./mutate-deps.ts";
import { parseReport, type ShardReport } from "./mutate-report.ts";
import { JSON_SUFFIX, SHORT_SHA } from "./mutate.constants.ts";

/** `a and b`, `a, b and c`: two items or more. */
function listOf(items: readonly string[]): string {
  const last = items.length - 1;
  return `${items.slice(0, last).join(", ")} and ${items[last]}`;
}

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];
export const shortOf = (head: string): string => head.slice(0, SHORT_SHA);

type Check = (dir: string, reports: ShardReport[]) => string | null;

const mixedHeads: Check = (dir, reports) => {
  const heads = unique(reports.map((report) => shortOf(report.head)));
  return heads.length > 1 ? `${dir} holds shards of ${listOf(heads)}; use one run's reports` : null;
};

const mixedTotals: Check = (dir, reports) => {
  const totals = unique(reports.map((report) => report.shard.total));
  return totals.length > 1 ? `${dir} mixes runs of ${listOf(totals.map(String))} shards; use one run's reports` : null;
};

const repeated: Check = (dir, reports) => {
  const seen = reports.map((report) => report.shard.index);
  const twice = seen.find((index, at) => seen.indexOf(index) !== at);
  return twice === undefined ? null : `${dir} holds shard ${twice} twice; use one run's reports`;
};

const missing: Check = (dir, reports) => {
  const total = reports.reduce((_, report) => report.shard.total, 0);
  const seen = reports.map((report) => report.shard.index);
  const absent = Array.from({ length: total }, (_, at) => at + 1).filter((index) => !seen.includes(index));
  if (absent.length === 0) return null;
  const noun = absent.length > 1 ? "shards" : "shard";
  return `${dir} is missing ${noun} ${absent.join(", ")} of ${total}; download every shard's report first`;
};

const CHECKS: readonly Check[] = [mixedHeads, mixedTotals, repeated, missing];

/** The reports in `dir` when they are one complete run; else the line that says what is wrong with them. */
export function loadShards(dir: string, deps: MutateDeps): ShardReport[] | string {
  const full = path.resolve(deps.cwd, dir);
  const names = (deps.fs.list(full) ?? []).filter((name) => name.endsWith(JSON_SUFFIX)).toSorted();
  if (names.length === 0) {
    const hint = `repo mutate --shard i/n --report ${dir}/mutation-i${JSON_SUFFIX}`;
    return `${dir} holds no mutation report; run \`${hint}\` first`;
  }
  const reports: ShardReport[] = [];
  for (const name of names) {
    const parsed = parseReport(deps.fs.read(path.join(full, name)) ?? "");
    if (!parsed.ok) return `${path.join(dir, name)} is not a mutation report: ${parsed.reason}`;
    reports.push(parsed.value);
  }
  for (const check of CHECKS) {
    const problem = check(dir, reports);
    if (problem !== null) return problem;
  }
  return reports;
}
