/** Scores per package and the floors they are held to: the formula, the floors file, and one run's verdict. */
import path from "node:path";
import { z } from "zod";
import { fail, type MutateConfig, type MutateDeps } from "./mutate-deps.ts";
import { parseJson, type FileScore, type Parsed, type ShardReport } from "./mutate-report.ts";
import { ARROW, NEWLINE, OK, PERCENT, PERCENT_DIGITS, ROOT_PACKAGE } from "./mutate.constants.ts";

/** A package's mutants: how many tests killed and how many lived. */
export type Tally = { killed: number; survivors: number };
/** The mutation score floors by package dir. */
export type Floors = Record<string, number>;
/** A package's score against its floor. */
export type Verdict = { pkg: string; percent: number; floor: number | undefined; survivors: number };

const buildFloorsSchema = () => z.record(z.string(), z.number());
const floorsSchema = /* @__PURE__ */ buildFloorsSchema();

/** (killed) / (killed + survivors) as a percent; a package with no scored mutant scores 100. */
export function percentOf({ killed, survivors }: Tally): number {
  const scored = killed + survivors;
  return scored === 0 ? PERCENT : (killed / scored) * PERCENT;
}

/** The deepest package dir holding `file`, else the root. */
export function packageOf(file: string, packages: readonly string[]): string {
  const holding = packages.filter((dir) => file.startsWith(`${dir}/`));
  return holding.toSorted((a, b) => b.length - a.length)[0] ?? ROOT_PACKAGE;
}

/** Each package's totals over `files`. */
export function tally(files: Record<string, FileScore>, packages: readonly string[]): Map<string, Tally> {
  const totals = new Map<string, Tally>();
  for (const [file, score] of Object.entries(files)) {
    const pkg = packageOf(file, packages);
    const was = totals.get(pkg) ?? { killed: 0, survivors: 0 };
    totals.set(pkg, { killed: was.killed + score.killed, survivors: was.survivors + score.survivors.length });
  }
  return totals;
}

/** The floors in `file` under `root`: none when it is missing, the reason when it is no table of numbers. */
export function readFloors(deps: MutateDeps, root: string, file: string): Parsed<Floors> {
  const text = deps.fs.read(path.join(root, file));
  if (text === null) return { ok: true, value: {} };
  const json = parseJson(text);
  if (!json.ok) return json;
  const parsed = floorsSchema.safeParse(json.value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, reason: parsed.error.issues.map((issue) => issue.message).join("; ") };
}

/** Every package's score against its floor, sorted by package. */
export function verdicts(totals: Map<string, Tally>, floors: Floors): Verdict[] {
  return [...totals]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([pkg, t]) => ({ pkg, percent: percentOf(t), floor: floors[pkg], survivors: t.survivors }));
}

const isBelow = (v: Verdict): boolean => v.floor !== undefined && v.percent < v.floor;
const percentText = (v: Verdict): string => `${v.percent.toFixed(PERCENT_DIGITS)}%`;
const floorOf = (v: Verdict): number => Math.floor(v.percent);

/** `pkg 89.86% (floor 89)`, with the floor's move when it is `raise`d: `(floor 85 → 89)`. */
export function label(v: Verdict, raise: boolean): string {
  const moved = raise && v.floor !== floorOf(v) && !isBelow(v);
  const floor = v.floor === undefined ? "no floor" : `floor ${v.floor}`;
  return `${v.pkg} ${percentText(v)} (${moved ? `floor ${v.floor ?? "new"} ${ARROW} ${floorOf(v)}` : floor})`;
}

/** One line per package below its floor, naming the floors file and where the survivors are. */
export function failures(vs: Verdict[], file: string, where: string): string[] {
  return vs
    .filter(isBelow)
    .map(
      (v) =>
        `${v.pkg} scored ${percentText(v)}, below its floor of ${v.floor} in ${file}; see the survivors in ${where}`,
    );
}

/** The floors with each package raised to its whole score; none lowered, none dropped. */
export function raised(floors: Floors, vs: Verdict[]): Floors {
  return { ...floors, ...Object.fromEntries(vs.map((v) => [v.pkg, Math.max(v.floor ?? 0, floorOf(v))])) };
}

/** `1 survivor`, `2 survivors`. */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A whole run: its report, the config it ran under and the report path as the person typed it. */
export type Judged = { report: ShardReport; config: MutateConfig; shown: string };

/** An unsharded run's verdict: each package's line, then a line per package below its floor; 1 if any. */
export function judgeRun(run: Judged, deps: MutateDeps): number {
  const { report, config, shown } = run;
  const floors = readFloors(deps, config.root, config.floors);
  if (!floors.ok) return fail(deps, `${config.floors} is not a floors file: ${floors.reason}`);
  const totals = tally(report.files, deps.packages(config.root));
  const vs = verdicts(totals, floors.value);
  for (const v of vs) {
    deps.out(`mutate: ${label(v, false)}, ${plural(v.survivors, "survivor")} in ${shown}${NEWLINE}`);
  }
  const lines = failures(vs, config.floors, shown);
  return lines.length > 0 ? fail(deps, ...lines) : OK;
}
