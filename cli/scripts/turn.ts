/**
 * `repo turn [<path>]` gates the working tree or one package, and `repo precommit` the index, with fmt, disable
 * comments, lint and its baseline, typecheck, reject files, sync, the stock history table (in this package's own
 * checkout) and check, precommit also with related tests before check, each step only when its inputs changed, then
 * prints one summary line. Only precommit restages, only what it rewrote, and right after the step that rewrote it, so
 * a later step reads the index as the commit will hold it. A file a step returned to the base leaves the change set
 * before the next step, and a gate with no change left runs no more steps. A step a passing gate ran is recorded
 * under its key, and a later gate skips it while the key holds. `gate-run.ts` runs the read steps beside the writes.
 */
import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import { findRoot, loadConfig, missingConfig } from "../config.ts";
import { childEnv } from "../env.ts";
import { readWorkspace } from "../sync/workspace.ts";
import type { Workspace } from "../sync/workspace.ts";
import { changeSet } from "./change-set.ts";
import { commentsStep } from "./comments-step.ts";
import { runGate, type Gate, type Parsed } from "./gate-run.ts";
import { capture, captureBun } from "./lint.ts";
import { missingNode, nodeRangesAt, type NodeRanges, vitestCommand } from "./node-run.ts";
import { tscBin } from "./package-bin.ts";
import { recordPasses } from "./pass-cache.ts";
import { rejectionsStep } from "./rejections-step.ts";
import { stockHistoryStep } from "./stock-history-step.ts";
import { checkStep, fmtStep, lintStep, syncStep, type Bins, type Turn } from "./turn-steps.ts";
import { typecheckStep } from "./typecheck-step.ts";

export type TurnDeps = { cwd?: string; stdout?: (s: string) => void; stderr?: (s: string) => void; bins?: Bins };

const TURN_USE = "use repo turn [<path>]";

/** Where a flag given to turn should go; an old hook that still passes `--staged` is fixed by a sync. */
const INDEX_HINT = `${TURN_USE}, or repo precommit for the index (bun repo sync updates an old pre-commit hook)`;

/**
 * Vitest from the package being tested, as its own tests would run: the node run on node; the main run on node when
 * the packages declare an engines.node range, else on bun. Node missing from PATH fails with an install hint.
 */
export function vitestBin(ranges: NodeRanges): Bins["vitest"] {
  return (args, cwd, run) => {
    const command = vitestCommand(cwd, run, args);

    if (command === null) return null;
    const env = childEnv({ NO_COLOR: "1" });

    if (run === "node")
      return capture("node", command, { cwd, env, missing: missingNode("repo ci", ranges.dev ?? ranges.engines) });

    if (ranges.engines === undefined) return captureBun(["--bun", ...command], cwd, env);

    const install = `install node ${ranges.engines}`;
    const missing = `repo ci: engines.node is set (${ranges.engines}) but node is not on PATH; ${install}`;

    return capture("node", command, { cwd, env, missing });
  };
}

/** typescript from this package's install; vitest from the package being tested, as its own tests would run. */
export const BINS: Bins = {
  tsc: async (args, cwd) => await captureBun([tscBin(), ...args], cwd),
  vitest: (args, cwd, run) => {
    const ranges = nodeRangesAt(cwd);

    if (!ranges.ok) return Promise.resolve({ code: 1, stderr: `repo ci: ${ranges.error}\n`, stdout: "" });

    return vitestBin(ranges.value)(args, cwd, run);
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

/** The steps both gates share: fmt and lint fix each file, sync and stock history may write any, three only read. */
export const SHARED: Pick<Gate, "fixes" | "writes" | "beside"> = {
  beside: [commentsStep, typecheckStep, rejectionsStep],
  fixes: [fmtStep, lintStep],
  writes: [syncStep, stockHistoryStep],
};

/** The agent's gate runs no tests. */
const TURN: Gate = { ...SHARED, after: [checkStep], name: "turn", parse: parseTurn };

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

  const { results, isRestaged, isEmptied, passes, cached } = await runGate(gate, prepared, stderr);
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
