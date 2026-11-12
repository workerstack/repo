/** The runner labels a spec's `os` takes: each is the label a machine of one platform and arch measures under. */
export const OS_LABELS = ["ubuntu-latest", "ubuntu-24.04-arm", "macos-latest", "macos-13", "windows-latest"] as const;

/** One of `OS_LABELS`. */
export type OsLabel = (typeof OS_LABELS)[number];

/** The label of the machine `bench` runs on, by `<platform> <arch>`; another machine is `<platform>-<arch>`. */
const LOCAL_LABELS = {
  "darwin arm64": "macos-latest",
  "darwin x64": "macos-13",
  "linux arm64": "ubuntu-24.04-arm",
  "linux x64": "ubuntu-latest",
  "win32 x64": "windows-latest",
} as const satisfies Readonly<Record<string, OsLabel>>;

function isLocalMachine(machine: string): machine is keyof typeof LOCAL_LABELS {
  return Object.hasOwn(LOCAL_LABELS, machine);
}

/** The label a machine of `platform` and `arch` measures under, or undefined when no runner has that machine. */
export function localLabelOf(platform: string, arch: string): OsLabel | undefined {
  const machine = `${platform} ${arch}`;

  return isLocalMachine(machine) ? LOCAL_LABELS[machine] : undefined;
}

/** A built-in metric's unit and the floor its median is raised to before scoring. */
type BuiltInMetric = { unit: string; floor: number };

/** The metrics every run measures, each with its unit and the floor its median is raised to before scoring. */
const BUILT_IN = {
  cpu: { floor: 1, unit: "ms" },
  rss: { floor: 1, unit: "MB" },
  wall: { floor: 0.1, unit: "ms" },
} as const satisfies Readonly<Record<string, BuiltInMetric>>;

function isBuiltInName(name: string): name is keyof typeof BUILT_IN {
  return Object.hasOwn(BUILT_IN, name);
}

/** The built-in metric called `name`, or undefined when `name` is a custom metric. */
export function builtInOf(name: string): BuiltInMetric | undefined {
  return isBuiltInName(name) ? BUILT_IN[name] : undefined;
}

/** The floor of a custom metric's median, so a zero never divides. */
export const CUSTOM_FLOOR = 1e-6;

/** A candidate or metric name. */
export const NAME: RegExp = /^[a-z0-9-]+$/;

/** Fewer runs give no median or CV worth reading. */
export const MIN_RUNS = 3;
export const DEFAULT_RUNS = 10;
export const DEFAULT_WARMUP = 1;

/** A CV over this is flagged as noise. */
export const CV_LIMIT = 0.1;
export const PERCENT = 100;

/** An rss median at most this many times the runner's own peak is flagged `~`: it may be the floor, not the child. */
export const RSS_FLOOR_MARGIN = 1.05;

/** Bun reports `maxRSS` in bytes on every platform (from 1.4.4) and `cpuTime` in microseconds. */
export const BYTES_PER_MB: number = 1024 ** 2;
export const BYTES_PER_GB: number = 1024 ** 3;
export const US_PER_MS = 1000;

/** Linux /proc status counts memory in kibibytes. */
export const BYTES_PER_KB = 1024;

/** The one platform whose children's peak RSS starts from the parent's, so the runner's own peak is a floor. */
export const FLOORED_PLATFORM = "linux";

/** The peak-RSS line of /proc/self/status, its kibibytes captured. */
export const VM_HWM: RegExp = /^VmHWM:\s+(\d+) kB$/mu;

/** The built-in peak-RSS metric, the one the floor bounds. */
export const RSS_METRIC = "rss";

/** A `slice` index counting from the end: the last element. */
export const LAST: number = -1;

/** A line break, LF or CRLF; split only. */
export const LINE_BREAK: RegExp = /\r?\n/;

/** The prefix of the stdout line a candidate reports its custom metrics on. */
export const BENCH_LINE = "bench: ";

/** The `origin/` of `origin/HEAD`'s answer, cut to the branch name. */
export const ORIGIN_PREFIX: RegExp = /^origin\//;

/** A matrix job's name, `bench (windows-latest)`, its OS captured. */
export const JOB_OS: RegExp = /^.*\((.+)\)$/;

/**
 * The gh run status that ends the wait, and the conclusions that are no failure. gh's status and conclusion sets
 * grow, so they stay strings and these are compared, not a closed enum a new value would fail to parse.
 */
export const RUN_COMPLETED = "completed";
export const CONCLUSION_SUCCESS = "success";
export const CONCLUSION_SKIPPED = "skipped";

/** How often `--remote` looks for its run and at it, and how long it waits for each. */
export const POLL_MS = 10_000;
const MS_PER_MINUTE = 60_000;
export const FIND_MINUTES = 5;
export const FIND_BOUND_MS: number = FIND_MINUTES * MS_PER_MINUTE;

/** The job's 60-minute timeout plus room for a queued runner. */
export const WAIT_MINUTES = 90;
export const WAIT_BOUND_MS: number = WAIT_MINUTES * MS_PER_MINUTE;

/** The workflow `--remote` dispatches, the event its runs carry, and the branch assumed when origin/HEAD is unset. */
export const WORKFLOW = "bench.yml";
export const DISPATCH_EVENT = "workflow_dispatch";
export const DEFAULT_BRANCH = "main";
export const SHA_SHOWN = 7;
