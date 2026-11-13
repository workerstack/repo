import { CONFIG_FILE } from "./config.constants.ts";
import { findRoot, loadConfig, missingConfig, type ResolvedConfig } from "./config.ts";
import type { Result } from "./result.ts";
import { errorMessage, fail } from "./sync-errors.ts";
import { computeOutputs } from "./sync-outputs.ts";
import { CHECK_FLAG, POSTINSTALL_FLAG, SYNC_PREFIX } from "./sync.constants.ts";
import type { SyncDeps, SyncIo } from "./sync.ts";
import { applyMigration } from "./sync/apply-migration.ts";
import { ignoreBlockLines, strayIgnoreFiles, untrackedEntries } from "./sync/git-files.ts";
import { normalizeRel, readManifest } from "./sync/manifest.ts";
import { moveLines, moveOldConfig } from "./sync/migrate-config-name.ts";
import { planRuleUpgrade } from "./sync/migrate-rules.ts";
import { generatedFiles, planAdoption, planMigration } from "./sync/migrate.ts";
import { planHandover } from "./sync/migration-handover.ts";
import type { Output } from "./sync/outputs.ts";
import { type StepRun, stepBlock } from "./sync/step-block.ts";
import { readStockHistory } from "./sync/stock-history.ts";
import { isSelf, stockRoot } from "./sync/stock.ts";
import { planStrategyRename } from "./sync/strategy-rename.ts";
import { planTmpRepo } from "./sync/tmp-repo.ts";
import { validateOutputs } from "./sync/validate-outputs.ts";
import { readWorkspace, type Workspace } from "./sync/workspace.ts";
import { writeOutputs } from "./write-outputs.ts";

type Mode = { check: boolean; postinstall: boolean };

type ModeResult = { ok: true; mode: Mode } | { ok: false; error: string };

/** One sync run: where and how it runs, and the config and outputs it last planned. */
export type Run = Mode & {
  root: string;
  io: SyncIo;
  deps: SyncDeps;
  load: typeof loadConfig;
  workspace: Workspace;
  resolved: ResolvedConfig;
  outputs: Output[];
};

/** `--check`, `--postinstall` or neither; any other flag, or both, is an error. */
export function parseMode(args: string[]): ModeResult {
  const mode: Mode = { check: false, postinstall: false };

  for (const arg of args) {
    if (arg === CHECK_FLAG) mode.check = true;
    else if (arg === POSTINSTALL_FLAG) mode.postinstall = true;
    else return { error: `unknown flag ${arg}; use --check or --postinstall`, ok: false };
  }

  if (mode.check && mode.postinstall) return { error: "use --check or --postinstall, not both", ok: false };

  return { mode, ok: true };
}

// A refusal before any output is written ends by saying so; `--check` writes nothing, so it has nothing to say about
// "written".
function refuse(run: Mode & { io: SyncIo }, errors: string[]): number {
  return fail(run, run.check ? errors : [...errors, "nothing written"]);
}

/**
 * An old consumer's config moves to its new name before the root is looked up by that name; the exit code when it
 * cannot.
 */
function moveConfig(early: Mode & { io: SyncIo }): number | null {
  const moved = moveOldConfig(early.io.cwd, { check: early.check });

  if (moved === null) return null;

  if ("error" in moved) return refuse(early, [moved.error]);

  for (const line of moveLines(moved.rewritten)) early.io.stdout(`${SYNC_PREFIX}${line}\n`);

  return null;
}

/** The run for the repo above `io.cwd`, with its config and workspace read; the exit code when one cannot be. */
async function open(mode: Mode, io: SyncIo, deps: SyncDeps): Promise<Result<Run, number>> {
  const early = { ...mode, io };
  const moved = moveConfig(early);

  if (moved !== null) return { error: moved, ok: false };
  const root = findRoot(io.cwd);

  if (root === null) return { error: fail(early, [missingConfig(io.cwd)]), ok: false };
  const load = deps.load ?? loadConfig;
  const config = await load(root);

  if (!config.ok) return { error: refuse(early, config.errors), ok: false };

  // Here the trees are the stock source; without the agents pack sync would prune them.
  if (isSelf(root) && !config.config.packs.includes("agents")) {
    const line = `${CONFIG_FILE}: this repo ships the agent trees as its stock source; keep "agents" in packs`;

    return { error: refuse(early, [line]), ok: false };
  }

  const workspace = readWorkspace(root);

  if (!workspace.ok) return { error: refuse(early, workspace.errors), ok: false };
  const run = { ...early, deps, load, outputs: [], resolved: config.config, root, workspace: workspace.workspace };

  return { ok: true, value: run };
}

/**
 * Rewrites old-format `.repo/` rules and subagents, marked where they replace a stock one, before anything reads them.
 */
async function upgrade(run: Run): Promise<void> {
  const steps = planRuleUpgrade(run.root, stockRoot(run.root));

  for (const line of await applyMigration(run.root, steps)) run.io.stdout(`${line}\n`);
}

/**
 * Outside this repo, the rule upgrade: `--check` fails while one is pending. The exit code when it stops, else null.
 */
async function upgradeRules(run: Run): Promise<number | null> {
  if (isSelf(run.root)) return null;
  const pending = planRuleUpgrade(run.root, stockRoot(run.root)).length;

  if (pending > 0 && run.check) {
    run.io.stderr(
      `${SYNC_PREFIX}${pending} migration step${pending === 1 ? "" : "s"} pending; run \`bun repo sync\`\n`,
    );

    return 1;
  }

  try {
    await upgrade(run);
  } catch (error) {
    return fail(run, [errorMessage(error)]);
  }

  return null;
}

// Nothing is migrated, adopted or written from outputs that would not parse or beside an ignore file sync refuses.
function invalid(run: Run, planned: Output[]): number | null {
  const hosts = run.resolved.agents.hosts;
  const ignored = ignoreBlockLines(run.workspace.manifest.name, hosts, planned);

  const problems = [
    ...strayIgnoreFiles(run.root, run.workspace, ignored),
    ...validateOutputs(run.root, planned, run.deps.formats),
  ];

  return problems.length === 0 ? null : refuse(run, problems);
}

/** Plans the outputs from what is on disk now; the exit code when that fails. */
function replan(run: Run): number | null {
  const { root, resolved: config, workspace, deps } = run;
  const planned = computeOutputs({ config, generators: deps.generators, post: deps.post, root, workspace });

  if (!planned.ok) return refuse(run, planned.errors);
  run.outputs = planned.outputs;

  return invalid(run, run.outputs);
}

/** Reads the config again, then plans the outputs; the exit code when either fails. */
async function replanReloaded(run: Run): Promise<number | null> {
  const reloaded = await run.load(run.root);

  if (!reloaded.ok) return fail(run, reloaded.errors);
  run.resolved = reloaded.config;

  return replan(run);
}

// What the user kept where the old layout put it moves to their own files before anything is planned from them,
// and again after each block that brought such a source back (a copied install's policy).
function handover(run: Run) {
  return planHandover(run.root, {
    history: readStockHistory(),
    packages: run.workspace.packages.map((pkg) => pkg.dir),
  });
}

/** What each block of steps needs from this run. */
function blocksOf(run: Run): StepRun {
  return {
    apply: async (steps) => {
      for (const line of await applyMigration(run.root, steps)) run.io.stdout(`${line}\n`);
      await upgrade(run);

      for (const line of await applyMigration(run.root, handover(run))) run.io.stdout(`${line}\n`);
    },
    check: run.check,
    fail: (errors) => fail(run, errors),
    postinstall: run.postinstall,
    replan: (reload) => (reload ? replanReloaded(run) : Promise.resolve(replan(run))),
    stderr: (s) => run.io.stderr(s),
  };
}

/**
 * A copied install moves to .repo/ and references/ before anything is planned from them; this repo never does. It
 * has no overlay yet, so what sync plans now is the stock's own generated text, the base its copies are compared
 * with. Whether it migrated; the exit code when it stops.
 */
async function migrate(run: Run, blocks: StepRun): Promise<Result<boolean, number>> {
  if (isSelf(run.root)) return { ok: true, value: false };
  const generated = generatedFiles(run.outputs);
  const ignored = untrackedEntries(run.resolved.agents.hosts, run.outputs);
  const steps = planMigration(run.root, { generated, ignored, stock: stockRoot(run.root) });
  const migration = await stepBlock({ noun: "migration", reload: true, steps }, blocks);

  return "exit" in migration ? { error: migration.exit, ok: false } : { ok: true, value: migration.applied };
}

/**
 * What a consumer already keeps where sync generates moves into `.repo/` before it is overwritten; a copied install
 * did that in its migration. The overlay it writes changes what the generators read, so the outputs are planned again.
 */
async function adopt(run: Run, blocks: StepRun): Promise<number | null> {
  const owned = readManifest(run.root).paths.flatMap((entry) => normalizeRel(entry, run.root) ?? []);
  const { root, resolved: config, outputs } = run;
  const steps = planAdoption(root, { config, manifest: owned, outputs, stock: stockRoot(root) });
  const adoption = await stepBlock({ noun: "adoption", steps }, blocks);

  return "exit" in adoption ? adoption.exit : null;
}

/**
 * The relocation of `.tmp/repo`, the rule upgrade, the handover, the first plan, the migration and the adoption; the
 * exit code when one stops.
 */
async function prepare(run: Run): Promise<number | null> {
  const blocks = blocksOf(run);
  const relocation = await stepBlock({ noun: "relocation", steps: planTmpRepo(run.root) }, blocks);

  if ("exit" in relocation) return relocation.exit;
  const renamed = await stepBlock({ noun: "strategy", steps: planStrategyRename(run.root) }, blocks);

  if ("exit" in renamed) return renamed.exit;
  const upgraded = await upgradeRules(run);

  if (upgraded !== null) return upgraded;
  const handed = await stepBlock({ noun: "handover", steps: handover(run) }, blocks);

  if ("exit" in handed) return handed.exit;
  const firstPlan = handed.applied ? null : replan(run);

  if (firstPlan !== null) return firstPlan;
  const migrated = await migrate(run, blocks);

  if (!migrated.ok) return migrated.error;

  return isSelf(run.root) || migrated.value ? null : adopt(run, blocks);
}

/** One `repo sync` over `args`; the exit code. */
export async function syncOnce(args: string[], io: SyncIo, deps: SyncDeps): Promise<number> {
  const parsed = parseMode(args);

  if (!parsed.ok) {
    io.stderr(`${SYNC_PREFIX}${parsed.error}\n`);

    return 1;
  }

  const run = await open(parsed.mode, io, deps);

  if (!run.ok) return run.error;

  return (await prepare(run.value)) ?? writeOutputs(run.value);
}
