/** Scores candidates on their medians and prints the table people read: one row per candidate, best first. */
import {
  BUILT_IN,
  BYTES_PER_GB,
  BYTES_PER_MB,
  CUSTOM_FLOOR,
  CV_LIMIT,
  PERCENT,
  RSS_FLOOR_MARGIN,
  RSS_METRIC,
  SHA_SHOWN,
} from "./bench.constants.ts";
import { byWeight, type Metric } from "./parse-spec.ts";
import { summarize, type Summary } from "./stats.ts";

/**
 * The machine a result was measured on, as `repo bench` reads it. `rssFloorBytes` is the runner's own peak RSS at the
 * end of the runs on Linux, where a child's peak starts from the parent's; null elsewhere, where peaks are per process.
 */
export type Machine = {
  platform: string;
  arch: string;
  cpu: string;
  cores: number;
  memoryBytes: number;
  bun: string;
  rssFloorBytes: number | null;
};

/** The machine, its os label, and the commit measured: its sha and whether the tree had changes. */
export type Env = Machine & { label: string; sha: string; dirty: boolean };

/** One candidate's measured samples by metric name, in run order. */
export type Samples = { name: string; samples: Readonly<Record<string, readonly number[]>> };

/** Everything a table is printed from; also the raw JSON a run writes and a remote run uploads. */
export type BenchResult = {
  spec: string;
  env: Env;
  runs: number;
  warmup: number;
  metrics: readonly Metric[];
  candidates: readonly Samples[];
};

const COLUMN_GAP = "  ";
const MEDIAN_DIGITS = 3;
const RANGE_DIGITS = 2;

/** At and over these, a median or a min/max prints as a whole number. */
const WHOLE_MEDIAN = 999.5;
const WHOLE_RANGE = 9.95;
const NOISE_FIX = "rerun with more runs or a quieter machine (load from other work counts)";
const FLOOR_IS = "is this runner's own peak on linux, which a child's count starts from;";
const FLOOR_BOUND = "its real peak is at most that";

/** A metric with the best floored median any candidate reached on it. */
type Best = { metric: Metric; best: number };

/** A candidate's row: its name, each metric's summary in column order, and its score. */
type Cell = { metric: Metric; summary: Summary };

type Row = { name: string; cells: Cell[]; score: number };

/** The value of `name` in `values`, 0 when it has none; read by entry so no lookup can come back undefined. */
function valueOf(values: Readonly<Record<string, number>>, name: string) {
  let found = 0;

  for (const [key, value] of Object.entries(values)) if (key === name) found = value;

  return found;
}

/** A median raised to its metric's floor: 0.1 ms wall, 1 ms cpu, 1 MB rss, 1e-6 for a custom metric. */
function floored(metric: Metric, value: number) {
  return Math.max(value, BUILT_IN[metric.name]?.floor ?? CUSTOM_FLOOR);
}

function bestsOf(metrics: readonly Metric[], medians: readonly Readonly<Record<string, number>>[]): Best[] {
  return metrics.map((metric) => {
    const values = medians.map((byMetric) => floored(metric, valueOf(byMetric, metric.name)));

    return { best: metric.better === "higher" ? Math.max(...values) : Math.min(...values), metric };
  });
}

/** The weighted mean of best/value (value/best when higher is better) over metrics, × 100. */
function scoreOf(bests: readonly Best[], medians: Readonly<Record<string, number>>) {
  let total = 0;
  let weighted = 0;

  for (const { best, metric } of bests) {
    const value = floored(metric, valueOf(medians, metric.name));
    total += metric.weight;
    weighted += metric.weight * (metric.better === "higher" ? value / best : best / value);
  }

  return (weighted / total) * PERCENT;
}

/**
 * Each candidate's score: the weighted mean over metrics of best/value (value/best when higher is better) on medians
 * raised to the metric's floor, × 100. The best candidate on every metric scores 100.
 */
export function scores(
  metrics: readonly Metric[],
  medians: Readonly<Record<string, Readonly<Record<string, number>>>>,
): Record<string, number> {
  const bests = bestsOf(metrics, Object.values(medians));

  return Object.fromEntries(Object.entries(medians).map(([name, byMetric]) => [name, scoreOf(bests, byMetric)]));
}

function median(value: number) {
  return Math.abs(value) >= WHOLE_MEDIAN ? String(Math.round(value)) : value.toPrecision(MEDIAN_DIGITS);
}

function bound(value: number) {
  return Math.abs(value) >= WHOLE_RANGE ? String(Math.round(value)) : value.toPrecision(RANGE_DIGITS);
}

function percent(cv: number) {
  return Math.round(cv * PERCENT);
}

/** Whether `c` is an rss median within the margin of the runner's own peak: it may count the runner, not the child. */
function nearFloor(floorBytes: number | null, { metric, summary }: Cell) {
  if (floorBytes === null || metric.name !== RSS_METRIC) return false;

  return summary.median <= (floorBytes / BYTES_PER_MB) * RSS_FLOOR_MARGIN;
}

/** `median ±CV% min–max`, with `!` after a CV over the limit and `~` after an rss median at the runner's floor. */
function cell(floorBytes: number | null, c: Cell) {
  const { summary } = c;
  const flags = `${summary.cv > CV_LIMIT ? "!" : ""}${nearFloor(floorBytes, c) ? "~" : ""}`;

  return `${median(summary.median)} ±${percent(summary.cv)}%${flags} ${bound(summary.min)}–${bound(summary.max)}`;
}

function header({ env, runs, spec, warmup }: BenchResult) {
  const commit = `${env.sha.slice(0, SHA_SHOWN)}${env.dirty ? "+dirty" : ""}`;
  const memory = `${Math.round(env.memoryBytes / BYTES_PER_GB)} GB`;
  const machine = `${env.label} (${env.platform} ${env.arch}) · ${env.cpu} (${env.cores}) · ${memory}`;

  return `${spec} · ${machine} · bun ${env.bun} · ${commit} · ${runs} runs, ${warmup} warmup`;
}

/** The text of column `at` of `row`, "" past its end. */
function textAt(row: readonly string[], at: number) {
  return row.slice(at, at + 1).join("");
}

/** The header row and the rows padded into columns two spaces apart; the score column is right-aligned. */
function columns(head: readonly string[], rows: readonly (readonly string[])[]) {
  const all = [head, ...rows];
  const widths = head.map((_, at) => Math.max(...all.map((row) => textAt(row, at).length)));

  return all.map((row) =>
    widths
      .map((width, at) => (at === 1 ? textAt(row, at).padStart(width) : textAt(row, at).padEnd(width)))
      .join(COLUMN_GAP)
      .trimEnd(),
  );
}

/** One candidate's samples of `name`, read by entry. */
function samplesOf(samples: Samples["samples"], name: string) {
  return Object.entries(samples).flatMap(([key, values]) => (key === name ? values : []));
}

/** The rows in `metrics` column order, best score first and then by name. */
function rowsOf(result: BenchResult, metrics: readonly Metric[]): Row[] {
  const summarized = result.candidates.map(({ name, samples }) => {
    const cells = metrics.map((metric) => ({ metric, summary: summarize(samplesOf(samples, metric.name)) }));
    const medians = Object.fromEntries(cells.map(({ metric, summary }) => [metric.name, summary.median]));

    return { cells, medians, name };
  });

  const bests = bestsOf(
    metrics,
    summarized.map(({ medians }) => medians),
  );

  return summarized
    .map(({ cells, medians, name }) => ({ cells, name, score: scoreOf(bests, medians) }))
    .toSorted((a, b) => (a.score === b.score ? a.name.localeCompare(b.name, "en") : b.score - a.score));
}

function title(metric: Metric) {
  return `${metric.name}${metric.unit === "" ? "" : ` ${metric.unit}`} (×${metric.weight})`;
}

function flagLines({ cells, name }: Row) {
  const limit = `over ${percent(CV_LIMIT)}%; ${NOISE_FIX}`;

  return cells
    .filter(({ summary }) => summary.cv > CV_LIMIT)
    .map(({ metric, summary }) => `! ${name} ${metric.name}: CV ${percent(summary.cv)}% ${limit}`);
}

/** A `~` line per candidate whose rss median sits at the runner's own peak, naming that peak. */
function floorLines(floorBytes: number | null, rows: readonly Row[]) {
  if (floorBytes === null) return [];
  const peak = `${median(floorBytes / BYTES_PER_MB)} MB`;

  return rows
    .filter(({ cells }) => cells.some((c) => nearFloor(floorBytes, c)))
    .map(({ name }) => `~ ${name} rss: ${peak} ${FLOOR_IS} ${FLOOR_BOUND}`);
}

/**
 * The table: the header naming the spec, machine and commit, one row per candidate (score, then each metric's median,
 * CV and range) with metric columns heaviest first, a `!` line for each metric whose CV is over 10%, and a `~` line for
 * each candidate whose rss median is within 5% of the runner's own peak (Linux), which a child's count starts from.
 */
export function renderTable(result: BenchResult): string {
  const metrics = result.metrics.toSorted(byWeight);
  const rows = rowsOf(result, metrics);
  const head = ["candidate", "score", ...metrics.map(title)];
  const floor = result.env.rssFloorBytes;
  const lines = rows.map((row) => [row.name, String(Math.round(row.score)), ...row.cells.map((c) => cell(floor, c))]);
  const notes = [...rows.flatMap(flagLines), ...floorLines(floor, rows)];

  return `${[header(result), ...columns(head, lines), ...notes].join("\n")}\n`;
}
