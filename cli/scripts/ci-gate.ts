import type { Captured } from "./lint.ts";
import type { Bins } from "./turn-steps.ts";

/** What a gate runs with: the repo root and the tools it runs. */
export type GateCtx = { root: string; bins: Bins };

/** A gate's outcome; `ran` is false when no tool ran, so there is no time to show. */
export type Gate = { label: string; ok: boolean; output: string[]; ran: boolean };

export function pass(label: string): Gate {
  return { label, ok: true, output: [], ran: true };
}

/** A gate that passed without running a tool, so it shows no time. */
export function skip(label: string): Gate {
  return { label, ok: true, output: [], ran: false };
}

export function fail(label: string, output: string[]): Gate {
  return { label, ok: false, output, ran: true };
}

/** A gate whose tool did not start: failed, with no output and no time. */
export function failToStart(label: string): Gate {
  return { label, ok: false, output: [], ran: false };
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function textOf(run: Captured) {
  return `${run.stdout}${run.stderr}`;
}
