import type { Captured } from "./lint.ts";
import type { Bins } from "./turn-steps.ts";

/** What a gate runs with: the repo root and the tools it runs. */
export type GateCtx = { root: string; bins: Bins };
/** A gate's outcome; `ran` is false when no tool ran, so there is no time to show. */
export type Gate = { label: string; ok: boolean; output: string[]; ran: boolean };

export const pass = (label: string, ran = true): Gate => ({ label, ok: true, output: [], ran });
export const fail = (label: string, output: string[], ran = true): Gate => ({ label, ok: false, output, ran });
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const textOf = (run: Captured) => `${run.stdout}${run.stderr}`;
