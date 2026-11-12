/** `repo mutate check <dir>`: merges the shard reports of one run, scores each package and holds it to its floor. */
import path from "node:path";

import { fail, type MutateConfig, type MutateDeps } from "./mutate-deps.ts";
import { failures, label, plural, raised, readFloors, tally, verdicts, type Floors } from "./mutate-floors.ts";
import { mergeFiles, type ShardReport } from "./mutate-report.ts";
import { loadShards, shortOf } from "./mutate-shards.ts";
import { JSON_INDENT, NEWLINE, OK, SEPARATOR } from "./mutate.constants.ts";

function text(floors: Floors): string {
  return `${JSON.stringify(floors, null, JSON_INDENT)}${NEWLINE}`;
}

type Check = { dir: string; write: boolean; config: MutateConfig; reports: ShardReport[]; floors: Floors };

/** The score lines, then a failure line per package below its floor; with `write`, the raised floors file. */
function settle({ dir, write, config, reports, floors }: Check, deps: MutateDeps): number {
  const vs = verdicts(tally(mergeFiles(reports), deps.packages(config.root)), floors);
  const lines = failures(vs, config.floors, dir);
  const next = raised(floors, vs);
  const writes = write && lines.length === 0 && text(next) !== text(floors);
  let lastHead = "";

  for (const report of reports) lastHead = report.head;
  const head = `${plural(reports.length, "shard")} of ${shortOf(lastHead)}`;
  const scores = vs.map((v) => label(v, { raise: write })).join(SEPARATOR);
  const wrote = writes ? `${SEPARATOR}wrote ${config.floors}` : "";
  deps.out(`mutate: ${head}${SEPARATOR}${scores}${wrote}${NEWLINE}`);

  if (writes) deps.fs.write(path.join(config.root, config.floors), text(next));

  return lines.length > 0 ? fail(deps, ...lines) : OK;
}

/** What `repo mutate check` scores: the `dir` of shard reports, and whether to `write` the raised floors. */
export type CheckRun = { dir: string; write: boolean };

/** Scores the merged `dir` of reports against the floors; with `write`, raises the floors file when none is below. */
export async function checkReports({ dir, write }: CheckRun, deps: MutateDeps): Promise<number> {
  const config = await deps.config(deps.cwd);

  if (Array.isArray(config)) return fail(deps, ...config);
  const reports = loadShards(dir, deps);

  if (typeof reports === "string") return fail(deps, reports);
  const floors = readFloors(deps, config.root, config.floors);

  if (!floors.ok) return fail(deps, `${config.floors} is not a floors file: ${floors.reason}`);

  return settle({ config, dir, floors: floors.value, reports, write }, deps);
}
