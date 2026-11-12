/**
 * `@workerstack/repo/bench`: `defineBench`, the default export of a `.repo/bench/<name>.bench.ts` spec that
 * `bun repo bench <name>` runs and scores.
 */
import type { OsLabel } from "./bench.constants.ts";

export type { OsLabel } from "./bench.constants.ts";

/** Whether a smaller or a larger median wins; the built-in `wall`, `cpu` and `rss` are lower is better. */
export type Better = "lower" | "higher";

/** A command to measure: `run` each run, after `setup` once. */
export type BenchCandidate = {
  /** The command and its args, run once per warmup and measured run; its wall time and usage are the run's. */
  run: string[];
  /** A command run once before any run, unmeasured, such as a build; a non-zero exit stops the bench. */
  setup?: string[];
};

/**
 * A metric to score: the built-in `wall`, `cpu` (ms) or `rss` (MB), or a name the candidate prints on its last stdout
 * line as `bench: {"<name>": <number>}`.
 */
export type BenchMetric = {
  /** Its share of the score, over 0; a metric of weight 2 counts twice one of weight 1. */
  weight: number;
  /** `lower` when omitted; a built-in metric takes only `lower`. */
  better?: Better;
  /** The unit shown in its column title; a built-in metric has its own and takes none. */
  unit?: string;
};

/** What a spec file's default export holds; names are `a-z`, `0-9` and `-`. */
export type BenchSpec = {
  /** The commands to compare, by name; at least one. */
  candidates: Record<string, BenchCandidate>;
  /** What each run is scored on, by name; at least one. */
  metrics: Record<string, BenchMetric>;
  /** Measured runs per candidate, at least 3; 10 when omitted. */
  runs?: number;
  /** Unmeasured runs per candidate before the measured ones; 1 when omitted. */
  warmup?: number;
  /** The runners `--remote` measures on as well; none when omitted. */
  os?: OsLabel[];
};

/** Returns `spec` as is; it types a spec file's default export. */
export function defineBench(spec: BenchSpec): BenchSpec {
  return spec;
}
