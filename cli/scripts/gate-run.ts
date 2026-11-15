/**
 * How `repo turn` and `repo precommit` run their steps. The first fix (fmt) runs alone. The other fixes (lint) then
 * run in order beside the write steps (sync, stock history), and the beside steps start at once when the writes end.
 * The fixes run again on the files that joined the change set since fmt ran. When a later fix rewrote a file, the
 * writes run again. A beside step whose pass key changed after it started reruns on the final change set once its
 * first run ended, and the after steps run at once last. Output and labels keep step order. Only `restage` writes the
 * index, with a blocking git, so two steps that end together never race for its lock.
 */
import { spawnSync } from "node:child_process";

import type { Workspace } from "../sync/workspace.ts";
import { changeSet, type Change, type Scope } from "./change-set.ts";
import { hasPass, passKeys } from "./pass-cache.ts";
import type { GateName, Step, StepResult, Turn } from "./turn-steps.ts";

/** A gate's arguments read into a scope, or why they cannot be. */
export type Parsed = { ok: true; scope: Scope } | { ok: false; errors: string[] };

/**
 * A command that gates a change set: its name, how it reads its arguments, and its steps. `fixes` rewrite each file
 * they gate and run again on the files a later step added; `writes` may write any file; `beside` only read and start
 * once the writes end; `after` only read and start once every fix and write ended.
 */
export type Gate = {
  name: GateName;
  parse: (argv: readonly string[], cwd: string, root: string) => Parsed;
  fixes: readonly Step[];
  writes: readonly Step[];
  beside: readonly Step[];
  after: readonly Step[];
};

/**
 * The steps' results in step order, false for `isRestaged` when a restage under precommit failed, true for
 * `isEmptied` when a step returned every change to the base, the keys of the steps that passed, and how many steps a
 * key skipped.
 */
export type Ran = { results: StepResult[]; isRestaged: boolean; isEmptied: boolean; passes: string[]; cached: number };

/** A step's outcome: its result, null when its inputs did not change or a key skipped it, then `isCached`. */
type Outcome = { result: StepResult | null; isCached: boolean };

/** A step, its first outcome, and the key it started on. */
type Started = { step: Step; outcome: Promise<Outcome>; key: string | null };

/** The outcome of a step a key skipped. */
const CACHED: Outcome = { isCached: true, result: null };

/** One gate's run: its start, its keys, the changes as the writes left them, and what it collected. */
type Run = {
  start: Turn;
  keys: ReturnType<typeof passKeys>;
  changes: readonly Change[];
  passes: string[];
  isRestaged: boolean;
  stderr: (s: string) => void;
};

/**
 * Stages the files a step rewrote, so the commit carries them as the gate left them; when git refuses (a held index
 * lock), says so, since the index would otherwise go out with the content the gate fixed only on disk.
 */
function restage(turn: Turn, touched: readonly string[], stderr: (s: string) => void): boolean {
  if (touched.length === 0) return true;

  if (spawnSync("git", ["add", "-A", "--", ...touched], { cwd: turn.root }).status === 0) return true;
  stderr(`repo ${turn.command}: git add failed for ${touched.join(" ")}; stage it yourself and commit again\n`);

  return false;
}

/**
 * The changes git still lists after a step rewrote files: one the step returned to the base leaves, one it wrote
 * joins, and no other joins. The package scope gates every file, so it keeps them all. A failed read keeps the set:
 * under precommit it fails only after a failed restage, which has already failed the gate and said what to stage.
 */
function remaining(run: Run, touched: readonly string[]): readonly Change[] {
  const { start } = run;

  if (start.scope.kind === "package") return run.changes;
  const now = changeSet(start.root, start.scope, start.packages);

  if (!now.ok) return run.changes;
  const gated = new Set([...run.changes.map((change) => change.rel), ...touched]);

  return now.changes.filter((change) => gated.has(change.rel));
}

/** `step` on `changes`, or skipped when its key there has a pass; the key it started on. */
function attempt(run: Run, step: Step, changes: readonly Change[]): Started {
  const key = run.keys.key(step.name, changes);

  if (key !== null && hasPass(run.start.root, key)) return { key, outcome: Promise.resolve(CACHED), step };

  return { key, outcome: step({ ...run.start, changes }).then((result) => ({ isCached: false, result })), step };
}

/**
 * A write step on `changes`: under precommit its rewrites restaged, the run's changes
 * and keys moved to the files it left, and its pass key taken right after it.
 */
async function write(run: Run, step: Step, changes: readonly Change[]): Promise<Outcome> {
  const outcome = await attempt(run, step, changes).outcome;
  const { result } = outcome;

  if (result === null) return outcome;

  if (run.start.scope.kind === "staged" && !restage(run.start, result.touched, run.stderr)) run.isRestaged = false;
  run.keys.moved();

  if (result.touched.length > 0) run.changes = remaining(run, result.touched);
  const after = run.keys.key(step.name, run.changes);

  if (result.ok && after !== null) run.passes.push(after);

  return outcome;
}

/** Write steps one after another, each on the run's changes or on `changes`, until one empties the change set. */
async function inOrder(run: Run, steps: readonly Step[], changes?: readonly Change[]) {
  const outcomes: Outcome[] = [];

  for (const step of steps) {
    // Each write reads the files the one before it left.
    outcomes.push(await write(run, step, changes ?? run.changes));

    if (run.changes.length === 0) return { isEmptied: true, outcomes };
  }

  return { isEmptied: false, outcomes };
}

/**
 * A fix's two runs as one: both outputs and rewrites, failed when either failed. The label is a failed run's, else
 * the one that rewrote files, the first run's when both or neither did.
 */
function merged(first: Outcome, joined: Outcome): Outcome {
  const [a, b] = [first.result, joined.result];

  if (b === null) return first;

  if (a === null) return joined;
  const isJoined = a.ok ? !b.ok || (a.touched.length === 0 && b.touched.length > 0) : false;
  const result = { label: isJoined ? b.label : a.label, ok: a.ok && b.ok, output: [...a.output, ...b.output] };

  return { isCached: false, result: { ...result, touched: [...a.touched, ...b.touched] } };
}

/** `outcome`, its pass recorded under `key` when it ran and passed. */
async function recorded(run: Run, outcome: Promise<Outcome>, key: string | null): Promise<Outcome> {
  const done = await outcome;

  if (done.result?.ok === true && key !== null) run.passes.push(key);

  return done;
}

/** A beside step's final outcome: its first run when its key held across the writes, else a rerun after it. */
function settled(run: Run, { step, ...started }: Started): Promise<Outcome> {
  const key = run.keys.key(step.name, run.changes);

  if (key !== null && key === started.key) return recorded(run, started.outcome, key);

  return recorded(
    run,
    started.outcome.then(async () => await attempt(run, step, run.changes).outcome),
    key,
  );
}

/** Prints each outcome's output in step order as it settles, and sums them up. */
async function finish(run: Run, slots: readonly (Outcome | Promise<Outcome>)[]): Promise<Omit<Ran, "isEmptied">> {
  const results: StepResult[] = [];
  let cached = 0;

  for (const slot of slots) {
    // Output keeps step order, so each slot waits for the ones before it.
    const { result, isCached } = await slot;

    if (isCached) cached += 1;

    if (result === null) continue;

    for (const chunk of result.output) run.stderr(chunk);
    results.push(result);
  }

  return { cached, isRestaged: run.isRestaged, passes: run.passes, results };
}

/** The fixes again on the files that joined the change set since the gate began, each merged into its first run. */
async function rejoin(run: Run, fixes: readonly Step[], outcomes: readonly Outcome[]) {
  const gated = new Set(run.start.changes.map((change) => change.rel));
  const joined = run.changes.filter((change) => !gated.has(change.rel));

  if (joined.length === 0) return { outcomes };
  const { outcomes: again } = await inOrder(run, fixes, joined);

  const merges = outcomes.map((outcome, i) => {
    const next = again[i];

    return next === undefined ? outcome : merged(outcome, next);
  });

  return { outcomes: merges };
}

/** A write's outcome after its rerun: the rerun's, unless the rerun found nothing to do. */
function latest(first: Outcome, rerun: Outcome | undefined): Outcome {
  return rerun === undefined || (rerun.result === null && !rerun.isCached) ? first : rerun;
}

/** The writes run again when one of the later fixes' `outcomes` rewrote a file; none when no fix did. */
async function rewrites(run: Run, gate: Gate, outcomes: readonly Outcome[]): Promise<Outcome[]> {
  if (!outcomes.some(({ result }) => (result?.touched.length ?? 0) > 0)) return [];
  const again = await inOrder(run, gate.writes);

  return again.outcomes;
}

/** The gate ended by a step that emptied the change set: the beside runs awaited and dropped. */
async function emptied(run: Run, started: readonly Started[], outcomes: readonly Outcome[]): Promise<Ran> {
  await Promise.all(started.map(({ outcome }) => outcome));

  return { ...(await finish(run, outcomes)), isEmptied: true };
}

/** The read steps' final outcomes: the beside ones settled across the late fixes, the after ones started now. */
function reads(run: Run, gate: Gate, started: readonly Started[]): Promise<Outcome>[] {
  const after = gate.after.map((step) => attempt(run, step, run.changes));

  return [...started.map((one) => settled(run, one)), ...after.map(({ outcome, key }) => recorded(run, outcome, key))];
}

/**
 * The later fixes beside the writes, and the beside steps started when the writes end. Then the fixes on the joined
 * files, and the writes again when a later fix rewrote a file they may read; a joined fix rewrites only what a write
 * wrote, so it sends no write back.
 */
async function middle(run: Run, gate: Gate, first: readonly Outcome[]) {
  const writing = inOrder(run, gate.writes);
  const beside = writing.then(() => gate.beside.map((step) => attempt(run, step, run.changes)));

  const [fixed, written, started] = await Promise.all([
    inOrder(run, gate.fixes.slice(1), run.changes),
    writing,
    beside,
  ]);

  const fixes = await rejoin(run, gate.fixes, [...first, ...fixed.outcomes]);
  const rewritten = await rewrites(run, gate, fixed.outcomes);
  const writes = written.outcomes.map((outcome, i) => latest(outcome, rewritten[i]));

  return { outcomes: [...fixes.outcomes, ...writes], started };
}

/** Runs `gate`'s steps on the prepared change set as the file comment says; see `Ran` for what it returns. */
export async function runGate(
  gate: Gate,
  { turn, workspace }: { turn: Turn; workspace: Workspace },
  stderr: (s: string) => void,
): Promise<Ran> {
  const run: Run = {
    changes: turn.changes,
    isRestaged: true,
    keys: passKeys(workspace),
    passes: [],
    start: turn,
    stderr,
  };

  const first = await inOrder(run, gate.fixes.slice(0, 1), run.changes);

  if (first.isEmptied) return await emptied(run, [], first.outcomes);
  const { outcomes, started } = await middle(run, gate, first.outcomes);

  if (run.changes.length === 0) return await emptied(run, started, outcomes);

  return { ...(await finish(run, [...outcomes, ...reads(run, gate, started)])), isEmptied: false };
}
