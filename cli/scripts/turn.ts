/**
 * `repo turn [<path>]` gates the working tree or one package, and `repo precommit` the index, with fmt, disable
 * comments, lint and its baseline, typecheck, reject files, sync, the stock history table (in this package's own
 * checkout) and check, precommit also with related tests before check, each step only when its inputs changed, then
 * prints one summary line. Only precommit restages, only what it rewrote, and right after the step that rewrote it, so
 * a later step reads the index as the commit will hold it. A file a step returned to the base leaves the change set
 * before the next step, and a gate with no change left runs no more steps. A step a passing gate ran is recorded
 * under its key, and a later gate skips it while the key holds.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import { findRoot, loadConfig, missingConfig } from "../config.ts";
import { childEnv } from "../env.ts";
import { NESTED_VITEST_FLAGS } from "../nested-vitest-flags.ts";
import type { Result } from "../result.ts";
import { nodeRange } from "../sync/node-range.ts";
import { readWorkspace } from "../sync/workspace.ts";
import type { Workspace } from "../sync/workspace.ts";
import { changeSet, type Change, type Scope } from "./change-set.ts";
import { commentsStep } from "./comments-step.ts";
import { capture, captureBun, type Captured } from "./lint.ts";
import { packageBin } from "./package-bin.ts";
import { hasPass, passKeys, recordPasses } from "./pass-cache.ts";
import { rejectionsStep } from "./rejections-step.ts";
import { stockHistoryStep } from "./stock-history-step.ts";
import {
  checkStep,
  fmtStep,
  lintStep,
  syncStep,
  type Bins,
  type GateName,
  type Step,
  type StepResult,
  type Turn,
} from "./turn-steps.ts";
import { typecheckStep } from "./typecheck-step.ts";

export type TurnDeps = { cwd?: string; stdout?: (s: string) => void; stderr?: (s: string) => void; bins?: Bins };

export type Parsed = { ok: true; scope: Scope } | { ok: false; errors: string[] };

/** A command that gates a change set: its name, its steps in order, and how it reads its arguments into a scope. */
export type Gate = {
  name: GateName;
  steps: readonly Step[];
  parse: (argv: readonly string[], cwd: string, root: string) => Parsed;
};

const TURN_USE = "use repo turn [<path>]";

/** Where a flag given to turn should go; an old hook that still passes `--staged` is fixed by a sync. */
const INDEX_HINT = `${TURN_USE}, or repo precommit for the index (bun repo sync updates an old pre-commit hook)`;

/** `command` run on node when `range` is set (failing with an install hint when node is not on PATH), else on bun. */
async function runVitest(range: string | undefined, command: string[], cwd: string): Promise<Captured> {
  const env = childEnv({ NO_COLOR: "1" });

  if (range === undefined) return await captureBun(["--bun", ...command], cwd, env);
  const missing = `repo ci: engines.node is set (${range}) but node is not on PATH; install node ${range}`;

  return await capture("node", command, { cwd, env, missing });
}

/**
 * Vitest from the package being tested, as its own tests would run: on node when the packages declare `range` as
 * engines.node (failing with an install hint when node is not on PATH), else on bun.
 */
export function vitestBin(range: string | undefined): Bins["vitest"] {
  return (args, cwd) => {
    let manifest: string;

    try {
      manifest = Bun.resolveSync("vitest/package.json", cwd);
    } catch {
      return null;
    }

    return runVitest(range, [packageBin(manifest, "vitest"), ...NESTED_VITEST_FLAGS, ...args], cwd);
  };
}

/**
 * The engines.node range of the workspace holding `cwd` (its repo root, else `cwd` itself), so a package dir sees a
 * range its root or a sibling declares; a workspace that cannot be read or declares two ranges fails as sync would.
 */
function rangeAt(cwd: string): Result<string | undefined, string> {
  const read = readWorkspace(findRoot(cwd) ?? cwd);

  return read.ok ? nodeRange(read.workspace) : { error: read.errors.join("; "), ok: false };
}

/** typescript from this package's install; vitest from the package being tested, as its own tests would run. */
export const BINS: Bins = {
  tsc: async (args, cwd) =>
    await captureBun(
      [packageBin(Bun.resolveSync("typescript/package.json", import.meta.dirname), "tsc"), ...args],
      cwd,
    ),
  vitest: (args, cwd) => {
    const range = rangeAt(cwd);

    if (!range.ok) return Promise.resolve({ code: 1, stderr: `repo ci: ${range.error}\n`, stdout: "" });

    return vitestBin(range.value)(args, cwd);
  },
};

/** At most one path, the package it names; none, the working tree. Turn takes no flags. */
function parseTurn(argv: readonly string[], cwd: string, root: string): Parsed {
  const flag = argv.find((arg) => arg.startsWith("-"));

  if (flag !== undefined) return { errors: [`unknown flag ${flag}; ${INDEX_HINT}`], ok: false };

  if (argv.length > 1) return { errors: [`one path at most; ${TURN_USE}`], ok: false };

  if (argv[0] === undefined) return { ok: true, scope: { kind: "tree" } };
  const rel = path.relative(root, path.resolve(cwd, argv[0])).split(path.sep).join("/");

  if (rel.startsWith("..") || path.isAbsolute(rel)) return { errors: [`${argv[0]} is outside ${root}`], ok: false };

  return { ok: true, scope: { kind: "package", rel } };
}

/** The steps both gates run before related tests: the ones that write files, then the ones that only read. */
export const BEFORE_TESTS: readonly Step[] = [
  fmtStep,
  lintStep,
  syncStep,
  stockHistoryStep,
  commentsStep,
  typecheckStep,
  rejectionsStep,
];

/** The agent's gate runs no tests. */
const TURN: Gate = { name: "turn", parse: parseTurn, steps: [...BEFORE_TESTS, checkStep] };

/** The root, its packages and the change set with the workspace read, or why turn cannot start. */
async function prepare(
  gate: Gate,
  argv: readonly string[],
  { cwd, bins }: { cwd: string; bins: Bins },
): Promise<{ ok: true; turn: Turn; workspace: Workspace } | { ok: false; errors: string[] }> {
  const root = findRoot(cwd);

  if (root === null) return { errors: [missingConfig(cwd)], ok: false };
  const parsed = gate.parse(argv, cwd, root);

  if (!parsed.ok) return parsed;
  const loaded = await loadConfig(root);

  if (!loaded.ok) return loaded;

  if (!loaded.config.packs.includes("standards"))
    return { errors: [`the standards pack is off; add "standards" to packs in ${CONFIG_FILE}`], ok: false };
  const workspace = readWorkspace(root);

  if (!workspace.ok) return workspace;
  const packages = workspace.workspace.packages.map((pkg) => pkg.dir);
  const changes = changeSet(root, parsed.scope, packages);

  if (!changes.ok) return changes;
  const { skip: skips } = loaded.config.lint;
  const turn = { bins, changes: changes.changes, command: gate.name, packages, root, scope: parsed.scope, skips };

  return { ok: true, turn, workspace: workspace.workspace };
}

/**
 * Stages the files turn rewrote, so the commit carries them as turn left them; when git refuses (a held index
 * lock), says so, since the index would otherwise go out with the content turn fixed only on disk.
 */
function restage(turn: Turn, touched: readonly string[], stderr: (s: string) => void): boolean {
  if (touched.length === 0) return true;

  if (spawnSync("git", ["add", "-A", "--", ...touched], { cwd: turn.root }).status === 0) return true;
  stderr(`repo ${turn.command}: git add failed for ${touched.join(" ")}; stage it yourself and commit again\n`);

  return false;
}

/**
 * The steps' results, false for `isRestaged` when a restage under precommit failed, true for `isEmptied` when a
 * step returned every change to the base, the keys of the steps that passed, and how many steps a key skipped.
 */
type Ran = { results: StepResult[]; isRestaged: boolean; isEmptied: boolean; passes: string[]; cached: number };

/**
 * The changes git still lists after a step rewrote files: one the step returned to the base leaves, one it wrote
 * joins, and no other joins. The package scope gates every file, so it keeps them all. A failed read keeps the set:
 * under precommit it fails only after a failed restage, which has already failed the turn and said what to stage.
 */
function remaining(turn: Turn, touched: readonly string[]): readonly Change[] {
  if (turn.scope.kind === "package") return turn.changes;
  const now = changeSet(turn.root, turn.scope, turn.packages);

  if (!now.ok) return turn.changes;
  const gated = new Set([...turn.changes.map((change) => change.rel), ...touched]);

  return now.changes.filter((change) => gated.has(change.rel));
}

/** The changes left after a step that ran, with the keys moved to the files it left. */
function settle(turn: Turn, result: StepResult, keys: { moved: () => void }): readonly Change[] {
  keys.moved();

  return result.touched.length === 0 ? turn.changes : remaining(turn, result.touched);
}

/** Prints a step's output and, under precommit, restages what it rewrote; false when that restage failed. */
function report(turn: Turn, result: StepResult, stderr: (s: string) => void): boolean {
  for (const chunk of result.output) stderr(chunk);

  return turn.scope.kind !== "staged" || restage(turn, result.touched, stderr);
}

/**
 * Runs every step whose inputs changed and whose key has no pass, printing a failed step's output as it ends, under
 * precommit restaging what it rewrote, and after a rewrite dropping the changes it returned to the base, before the
 * next step. A step's pass is keyed on the files right after it ran, its own rewrites in.
 */
async function runSteps(
  steps: readonly Step[],
  { turn: start, workspace }: { turn: Turn; workspace: Workspace },
  stderr: (s: string) => void,
): Promise<Ran> {
  let changes = start.changes;
  let isRestaged = true;
  let cached = 0;
  const results: StepResult[] = [];
  const passes: string[] = [];
  const keys = passKeys(workspace);

  for (const step of steps) {
    const turn: Turn = { ...start, changes };
    const before = keys.key(step.name, changes);

    if (before !== null && hasPass(turn.root, before)) {
      cached += 1;
      continue;
    }

    const result = await step(turn);

    if (result === null) continue;

    if (!report(turn, result, stderr)) isRestaged = false;
    results.push(result);

    changes = settle(turn, result, keys);
    const after = keys.key(step.name, changes);

    if (result.ok && after !== null) passes.push(after);

    if (changes.length === 0) return { cached, isEmptied: true, isRestaged, passes, results };
  }

  return { cached, isEmptied: false, isRestaged, passes, results };
}

/** The deps with the process's own for each one left out. */
function withDefaults(deps: TurnDeps): Required<TurnDeps> {
  return {
    bins: deps.bins ?? BINS,
    cwd: deps.cwd ?? process.cwd(),
    stderr: deps.stderr ?? ((s: string) => process.stderr.write(s)),
    stdout: deps.stdout ?? ((s: string) => process.stdout.write(s)),
  };
}

/** Runs `gate` on its change set and prints one summary line; 0 when every step it ran passed. */
export async function gateMain(gate: Gate, argv: readonly string[], deps: TurnDeps): Promise<number> {
  const { cwd, stdout, stderr, bins } = withDefaults(deps);
  const prepared = await prepare(gate, argv, { bins, cwd });

  if (!prepared.ok) {
    for (const line of prepared.errors) stderr(`repo ${gate.name}: ${line}\n`);

    return 1;
  }

  const { turn } = prepared;

  if (turn.changes.length === 0) {
    stdout(`${gate.name}: no changes\n`);

    return 0;
  }

  const { results, isRestaged, isEmptied, passes, cached } = await runSteps(gate.steps, prepared, stderr);
  const files = `${turn.changes.length} file${turn.changes.length === 1 ? "" : "s"}`;
  const ran = results.map((result) => result.label);
  const labels = [...ran, ...(cached > 0 ? [`${cached} cached`] : []), ...(isEmptied ? ["no changes left"] : [])];
  stdout(`${gate.name}: ${files} · ${labels.join(" · ")}\n`);
  const isPassed = isRestaged && results.every((result) => result.ok);

  if (isPassed) recordPasses(turn.root, passes);

  return isPassed ? 0 : 1;
}

/** `repo turn [<path>]`: the agent's gate over the working tree or one package, without tests. */
export function main(argv: string[], deps: TurnDeps = {}): Promise<number> {
  return gateMain(TURN, argv, deps);
}
