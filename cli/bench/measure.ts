/** One run of a candidate command: the real process runner, its resource usage in table units, and its custom line. */
import { z } from "zod";

import { childEnv } from "../env.ts";
import { type JsonObject, tryJson } from "../json.ts";
import { BENCH_LINE, BYTES_PER_KB, BYTES_PER_MB, FLOORED_PLATFORM, US_PER_MS, VM_HWM } from "./bench.constants.ts";

/** The part of Bun's `ResourceUsage` a run reads: peak RSS in bytes and CPU time in microseconds. */
export type Usage = { maxRSS: number; cpuTime: { user: bigint; system: bigint } };

/** A finished run: its exit code, its output and its resource usage. */
export type Spawned = { code: number; stdout: string; stderr: string; usage: Usage };

/** Runs a command to completion in `cwd`. */
export type Spawn = (cmd: readonly string[], cwd: string) => Spawned;

/** A run's custom metrics by name, or the first declared one it did not print. */
export type Custom = { ok: true; values: Record<string, number> } | { ok: false; missing: string };

/** No usage, for a command that never started. */
const NO_USAGE: Usage = { cpuTime: { system: 0n, user: 0n }, maxRSS: 0 };

/**
 * Runs `cmd` with `Bun.spawnSync`, which gives the child's own rusage (node's `spawnSync` gives none). A command that
 * cannot start is a failed run with the reason as its stderr.
 */
export function spawnBun(cmd: readonly string[], cwd: string): Spawned {
  try {
    const run = Bun.spawnSync([...cmd], { cwd, env: childEnv(), stderr: "pipe", stdout: "pipe" });
    const { cpuTime, maxRSS } = run.resourceUsage;
    const usage = { cpuTime, maxRSS };

    return { code: run.exitCode, stderr: run.stderr.toString(), stdout: run.stdout.toString(), usage };
  } catch (error) {
    return { code: 1, stderr: String(error), stdout: "", usage: NO_USAGE };
  }
}

/** The cpu time in ms and the peak rss in MB one run used. */
type UsageMetrics = { cpu: number; rss: number };

/**
 * A run's `cpu` in ms (user plus system) and `rss` in MB. Bun 1.4.4 reports `maxRSS` in bytes on every platform: it
 * scales Linux's kilobytes itself, and macOS's `ru_maxrss` and Windows' `PeakWorkingSetSize` are bytes.
 */
export function usageMetrics(usage: Usage): UsageMetrics {
  const micros = usage.cpuTime.user + usage.cpuTime.system;

  return { cpu: Number(micros) / US_PER_MS, rss: usage.maxRSS / BYTES_PER_MB };
}

/** The JSON object after `bench: ` on the last line of `stdout`, or null when that line is not one. */
function benchObject(stdout: string): JsonObject | null {
  const output = stdout.trimEnd();
  const last = output.slice(output.lastIndexOf("\n") + 1);

  if (!last.startsWith(BENCH_LINE)) return null;

  return tryJson(z.record(z.string(), z.json()), last.slice(BENCH_LINE.length)) ?? null;
}

/** Reads the `names` metrics from the last stdout line, `bench: {"<name>": <number>, ...}`. */
export function readCustom(stdout: string, names: readonly string[]): Custom {
  const values: Record<string, number> = {};
  const object = names.length === 0 ? {} : benchObject(stdout);

  for (const name of names) {
    const value = object?.[name];

    if (typeof value !== "number" || !Number.isFinite(value)) return { missing: name, ok: false };
    values[name] = value;
  }

  return { ok: true, values };
}

/**
 * This process's peak RSS in bytes on Linux, from the VmHWM line of `status()` (/proc/self/status, in kB); null off
 * Linux or without the line. On Linux a spawned child's maxRSS starts from it, since the kernel carries the parent's
 * hiwater mark across exec; it only grows, so a read after the runs bounds every run's floor.
 */
export function rssFloorOf(platform: string, status: () => string): number | null {
  if (platform !== FLOORED_PLATFORM) return null;
  const kb = VM_HWM.exec(status())?.[1];

  return kb === undefined ? null : Number(kb) * BYTES_PER_KB;
}
