/**
 * One `repo mutate` run in a throwaway clone of HEAD: clone, install, Stryker, its report; the clone is always
 * removed.
 */
import path from "node:path";

import { z } from "zod";

import { EXCLUDE_KEY } from "../presets/vitest.constants.ts";
import type { Shard } from "./mutate-args.ts";
import type { MutateDeps } from "./mutate-deps.ts";
import { splitShards } from "./mutate-files.ts";
import { fromStryker, readParsed, type ShardReport } from "./mutate-report.ts";
import {
  BUN_FLAGS,
  CLONE_DIR,
  CONFIG_NAME,
  INSTALL_ARGS,
  INSTALL_COMMAND,
  INSTALL_HINT,
  INSTALLED_DIR,
  JSON_INDENT,
  MANIFEST,
  NEWLINE,
  NODE_PREFIX,
  RAW_REPORT_NAME,
  SHORT_SHA,
  STRYKER_BIN_NAME,
  STRYKER_CORE,
  STRYKER_OPTIONS,
  STRYKER_RUNNER,
  STRYKER_RUN,
  TEMP_PREFIX,
} from "./mutate.constants.ts";
import type { Result } from "./result.ts";
import type { Captured } from "./scripts/lint.ts";
import { NODE_CONFIG, type TestRun } from "./scripts/node-run.ts";

/** What a run mutates: the root, the commit, every selected file and the shard of them this run takes. */
export type Plan = { root: string; sha: string; files: string[]; shard: Shard };

/** A Stryker shard's plan: the tests its run leaves out beside the rest. */
export type StrykerPlan = Plan & { exclude: readonly string[] };

/** Stryker's manifest `bin`, a path or a map of names to paths, read as the path of its own bin. */
function buildBinSchema() {
  const named = z.record(z.string(), z.string()).transform((bins) => bins[STRYKER_BIN_NAME]);

  return z.object({ bin: z.union([z.string(), named]) });
}

const binSchema = /* @__PURE__ */ buildBinSchema();

/** A failed command's own words: its stderr, else its stdout. */
function detail(run: Captured): string {
  const stderr = run.stderr.trim();

  return stderr === "" ? run.stdout.trim() : stderr;
}

/** Prints a refusal and returns null, the failure every step answers with. */
export function refuse(deps: MutateDeps, line: string, extra = ""): null {
  deps.err(`repo mutate: ${line}${NEWLINE}${extra}`);

  return null;
}

/** Clones the root shared, then detaches the clone to the commit; false after saying why when git fails. */
export function checkout(clone: string, plan: Plan, deps: MutateDeps): boolean {
  const cloned = deps.git(plan.root, ["clone", "-q", "--shared", plan.root, clone]);
  const detach = ["-C", clone, "checkout", "-q", "--detach", plan.sha];
  const last = cloned.code === 0 ? deps.git(plan.root, detach) : cloned;

  if (last.code === 0) return true;
  const what = cloned.code === 0 ? `check out ${plan.sha.slice(0, SHORT_SHA)} in the clone` : `clone ${plan.root}`;
  refuse(deps, `could not ${what}: ${detail(last)}`);

  return false;
}

/** The path of Stryker's bin in the clone, or null after printing the install line when the tool is not installed. */
function strykerBin(clone: string, deps: MutateDeps): string | null {
  const modules = path.join(clone, INSTALLED_DIR);
  const core = deps.fs.read(path.join(modules, STRYKER_CORE, MANIFEST));
  const runner = deps.fs.read(path.join(modules, STRYKER_RUNNER, MANIFEST));
  const manifest = core === null || runner === null ? null : readParsed(binSchema, core);
  const relative = manifest?.ok === true ? manifest.value.bin : undefined;

  if (relative === undefined) return refuse(deps, `install the mutation tool first: ${INSTALL_HINT}`);

  return path.join(modules, STRYKER_CORE, relative);
}

/**
 * The Stryker config for `files`, written beside the clone with its raw report path; the node run's vitest runs the
 * node config.
 */
function configOf(files: string[], rawReport: string, run: TestRun): string {
  const vitest = run === "node" ? { ...STRYKER_OPTIONS.vitest, configFile: NODE_CONFIG } : STRYKER_OPTIONS.vitest;
  const config = { ...STRYKER_OPTIONS, jsonReporter: { fileName: rawReport }, mutate: files, vitest };

  return JSON.stringify(config, null, JSON_INDENT);
}

function lineCounts(clone: string, files: string[], deps: MutateDeps): Map<string, number> {
  function count(file: string) {
    return (deps.fs.read(path.join(clone, file)) ?? "").split(NEWLINE).length;
  }

  return new Map(files.map((file) => [file, count(file)]));
}

/** What one Stryker run needs: the files to mutate, its bin, the tests its run leaves out, and which test run it is. */
type StrykerRun = { files: string[]; bin: string; exclude: readonly string[]; testRun: TestRun };

/**
 * The variables Stryker's run gets: the tests it leaves out, as the vitest preset reads them, since the run rewrites
 * the source in place and a test that reads it sees every mutant at once. None when it leaves out none.
 */
function strykerEnv(exclude: readonly string[]): Readonly<Record<string, string>> | undefined {
  return exclude.length === 0 ? undefined : { [EXCLUDE_KEY]: JSON.stringify(exclude) };
}

type Launched = Result<Captured, string>;

/** Stryker's bin running `config` in the clone: the main run under bun with the preload, the node run on node. */
async function launch(run: StrykerRun, at: { clone: string; config: string }, deps: MutateDeps): Promise<Launched> {
  const { clone, config } = at;
  const env = strykerEnv(run.exclude);
  const args = [STRYKER_RUN, config];

  if (run.testRun === "node") return await deps.node([run.bin, ...args], clone, env);

  return { ok: true, value: await deps.run([...BUN_FLAGS, deps.preload, run.bin, ...args], clone, env) };
}

/** Stryker over `files` in the clone: its per-file scores, or null after printing why it gave none. */
async function stryker(base: string, run: StrykerRun, deps: MutateDeps): Promise<ShardReport["files"] | null> {
  const { files, testRun } = run;
  const clone = path.join(base, CLONE_DIR);
  const prefix = testRun === "node" ? NODE_PREFIX : "";
  const config = path.join(base, `${prefix}${CONFIG_NAME}`);
  const raw = path.join(base, `${prefix}${RAW_REPORT_NAME}`);
  deps.fs.write(config, configOf(files, raw, testRun));
  const launched = await launch(run, { clone, config }, deps);

  if (!launched.ok) {
    deps.err(`${launched.error}${NEWLINE}`);

    return null;
  }

  const ran = launched.value;

  if (ran.code !== 0)
    return refuse(deps, "the tests failed before any mutant ran; fix them first", ran.stdout + ran.stderr);

  const text = deps.fs.read(raw);

  if (text === null) return refuse(deps, "Stryker wrote no readable report: the report file is missing");
  // Stryker's report is read twice: as JSON here, then by fromStryker into per-file scores.
  const json = readParsed(z.json(), text);
  const scores = json.ok ? fromStryker(json.value) : json;

  return scores.ok ? scores.value : refuse(deps, `Stryker wrote no readable report: ${scores.reason}`);
}

/** A finished run: the shard's report and how many files it took. */
export type Ran = { report: ShardReport; files: number };

async function mutateIn(base: string, plan: StrykerPlan, deps: MutateDeps): Promise<Ran | null> {
  const clone = path.join(base, CLONE_DIR);

  if (!checkout(clone, plan, deps)) return null;
  const mine = splitShards(plan.files, lineCounts(clone, plan.files, deps), plan.shard);

  function ran(files: ShardReport["files"]): Ran {
    return {
      files: mine.length,
      report: { files, head: plan.sha, shard: plan.shard, tool: "stryker" },
    };
  }

  if (mine.length === 0) return ran({});
  const installed = await deps.run([...INSTALL_ARGS], clone);

  if (installed.code !== 0) return refuse(deps, `${INSTALL_COMMAND} failed in the clone: ${detail(installed)}`);
  const bin = strykerBin(clone, deps);

  if (bin === null) return null;
  const globs = await deps.nodeGlobs(clone);

  if (!globs.ok) return refuse(deps, globs.error);
  const scores = await bothRuns(base, { bin, exclude: plan.exclude, files: mine, globs: globs.value }, deps);

  return scores === null ? null : ran(scores);
}

/** What the two runs of a shard need: its files, the bin, the tests left out, and the node config's globs, if any. */
type Runs = { files: string[]; bin: string; exclude: readonly string[]; globs: readonly string[] | null };

/**
 * The shard's scores from Stryker on the main run for the files no node config glob matches, then on node for the rest,
 * one after the other since both rewrite the clone's sources in place; a run with no files is skipped. Null after the
 * first run that printed why it gave none.
 */
async function bothRuns(base: string, runs: Runs, deps: MutateDeps): Promise<ShardReport["files"] | null> {
  const { files, bin, exclude, globs } = runs;

  function isNode(file: string) {
    return globs?.some((glob) => path.matchesGlob(file, glob)) === true;
  }

  async function scored(testRun: TestRun, mine: string[]): Promise<ShardReport["files"] | null> {
    return mine.length === 0 ? {} : await stryker(base, { bin, exclude, files: mine, testRun }, deps);
  }

  const main = await scored(
    "main",
    files.filter((file) => !isNode(file)),
  );

  if (main === null) return null;

  const node = await scored(
    "node",
    files.filter((file) => isNode(file)),
  );

  return node === null ? null : { ...main, ...node };
}

/** `mutate`'s result for the plan, run in a fresh dir under the OS temp dir, removed whether the run ends or throws. */
export async function inTempDir<P extends Plan>(
  plan: P,
  deps: MutateDeps,
  mutate: (base: string, plan: P, deps: MutateDeps) => Ran | null | Promise<Ran | null>,
): Promise<Ran | null> {
  const base = deps.fs.mkdtemp(TEMP_PREFIX);

  try {
    return await mutate(base, plan, deps);
  } finally {
    deps.fs.rm(base);
  }
}

/** The shard's scores from a run in a fresh clone under the OS temp dir, removed whether the run ends or throws. */
export async function runInClone(plan: StrykerPlan, deps: MutateDeps): Promise<Ran | null> {
  return await inTempDir(plan, deps, mutateIn);
}
