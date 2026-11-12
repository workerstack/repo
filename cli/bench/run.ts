/** Runs a parsed spec: each setup once, then warmup plus measured runs of every candidate, interleaved. */
import type { Result } from "../result.ts";
import { builtInOf, LINE_BREAK } from "./bench.constants.ts";
import { readCustom, usageMetrics, type Spawn } from "./measure.ts";
import type { Candidate, Spec } from "./parse-spec.ts";
import type { Samples } from "./score.ts";

/** Where the candidates run, the runner, and the clock in milliseconds a run's wall time is read from. */
export type RunIo = { cwd: string; spawn: Spawn; now: () => number };

/** Each candidate's samples by metric, or the line naming the run that failed. */
export type RunOutcome = { ok: true; candidates: Samples[] } | { ok: false; line: string };

const TAIL_LINES = 3;

/** `exited <code>` and the last lines of stderr, so the reason shows without the noise above it. */
function exited(code: number, stderr: string) {
  const tail = stderr
    .split(LINE_BREAK)
    .filter((text) => text.trim() !== "")
    .slice(-TAIL_LINES)
    .join(" | ");

  return `exited ${code}; ${tail === "" ? "no stderr" : `stderr tail: ${tail}`}`;
}

/** The first failed setup's line, or null when every setup passed. */
function setUp(spec: Spec, io: RunIo): string | null {
  for (const { name, setup } of spec.candidates) {
    if (setup === null) continue;
    const got = io.spawn(setup, io.cwd);

    if (got.code !== 0) return `${name} setup ${exited(got.code, got.stderr)}`;
  }

  return null;
}

/** One run's value of each spec metric by name, or the line saying why the run counts for nothing. */
type Measuring = { candidate: Candidate; label: string };

function measure(spec: Spec, io: RunIo, { candidate, label }: Measuring): Result<Record<string, number>, string> {
  const names = new Set(spec.metrics.map((metric) => metric.name));
  const custom = [...names].filter((name) => builtInOf(name) === undefined);
  const started = io.now();
  const got = io.spawn(candidate.run, io.cwd);
  const wall = io.now() - started;

  if (got.code !== 0) return { error: `${label} ${exited(got.code, got.stderr)}`, ok: false };
  const read = readCustom(got.stdout, custom);

  if (!read.ok) return { error: `${label} printed no \`bench:\` line with ${JSON.stringify(read.missing)}`, ok: false };
  const measured = Object.entries({ ...usageMetrics(got.usage), wall, ...read.values });

  return { ok: true, value: Object.fromEntries(measured.filter(([name]) => names.has(name))) };
}

/** A kept run: the candidate it measured and its values by metric. */
type Kept = { name: string; values: Record<string, number> };

/** Every kept value of `metric` in `runs`, in run order. */
function valuesOf(runs: readonly Kept[], metric: string) {
  return runs.flatMap(({ values }) =>
    Object.entries(values).flatMap(([key, value]) => (key === metric ? [value] : [])),
  );
}

/** Each candidate's kept values of each metric, in run order. */
function samplesOf(spec: Spec, kept: readonly Kept[]): Samples[] {
  return spec.candidates.map(({ name }) => {
    const mine = kept.filter((run) => run.name === name);
    const samples: [string, number[]][] = spec.metrics.map((metric) => [metric.name, valuesOf(mine, metric.name)]);

    return { name, samples: Object.fromEntries(samples) };
  });
}

/** Runs every candidate `warmup + runs` times, round-robin so drift in the machine's load spreads over all of them. */
export function runSpec(spec: Spec, io: RunIo): RunOutcome {
  const failedSetup = setUp(spec, io);

  if (failedSetup !== null) return { line: failedSetup, ok: false };
  const kept: Kept[] = [];

  for (let at = 0; at < spec.warmup + spec.runs; at += 1) {
    const isWarm = at < spec.warmup;

    for (const candidate of spec.candidates) {
      const label = `${candidate.name} ${isWarm ? `warmup ${at + 1}` : `run ${at - spec.warmup + 1}`}`;
      const got = measure(spec, io, { candidate, label });

      if (!got.ok) return { line: got.error, ok: false };

      if (!isWarm) kept.push({ name: candidate.name, values: got.value });
    }
  }

  return { candidates: samplesOf(spec, kept), ok: true };
}
