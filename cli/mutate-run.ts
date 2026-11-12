/**
 * One `repo mutate` run in a throwaway clone of HEAD: clone, install, Stryker, its report; the clone is always
 * removed.
 */
import path from "node:path";

import { z } from "zod";

import type { Shard } from "./mutate-args.ts";
import type { MutateDeps } from "./mutate-deps.ts";
import { splitShards } from "./mutate-files.ts";
import { fromStryker, parseJson, type ShardReport } from "./mutate-report.ts";
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
  RAW_REPORT_NAME,
  SHORT_SHA,
  STRYKER_BIN_NAME,
  STRYKER_CORE,
  STRYKER_OPTIONS,
  STRYKER_RUNNER,
  STRYKER_RUN,
  TEMP_PREFIX,
} from "./mutate.constants.ts";
import type { Captured } from "./scripts/lint.ts";

/** What a run mutates: the root, the commit, every selected file and the shard of them this run takes. */
export type Plan = { root: string; sha: string; files: string[]; shard: Shard };

function buildBinSchema() {
  return z.object({ bin: z.union([z.string(), z.record(z.string(), z.string())]) });
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
  const manifest = core === null || runner === null ? null : parseJson(core);
  const parsed = manifest?.ok === true ? binSchema.safeParse(manifest.value) : null;
  const bin = parsed?.success === true ? parsed.data.bin : undefined;
  const relative = typeof bin === "string" ? bin : bin?.[STRYKER_BIN_NAME];

  if (relative === undefined) return refuse(deps, `install the mutation tool first: ${INSTALL_HINT}`);

  return path.join(modules, STRYKER_CORE, relative);
}

/** The Stryker config for `files`, written beside the clone with its raw report path. */
function configOf(files: string[], rawReport: string): string {
  const config = { ...STRYKER_OPTIONS, jsonReporter: { fileName: rawReport }, mutate: files };

  return JSON.stringify(config, null, JSON_INDENT);
}

function lineCounts(clone: string, files: string[], deps: MutateDeps): Map<string, number> {
  function count(file: string) {
    return (deps.fs.read(path.join(clone, file)) ?? "").split(NEWLINE).length;
  }

  return new Map(files.map((file) => [file, count(file)]));
}

/** Stryker over `files` in the clone: its per-file scores, or null after printing why it gave none. */
function stryker(base: string, run: { files: string[]; bin: string }, deps: MutateDeps): ShardReport["files"] | null {
  const { files, bin } = run;
  const clone = path.join(base, CLONE_DIR);
  const config = path.join(base, CONFIG_NAME);
  const raw = path.join(base, RAW_REPORT_NAME);
  deps.fs.write(config, configOf(files, raw));
  const ran = deps.run([...BUN_FLAGS, deps.preload, bin, STRYKER_RUN, config], clone);

  if (ran.code !== 0)
    return refuse(deps, "the tests failed before any mutant ran; fix them first", ran.stdout + ran.stderr);

  const text = deps.fs.read(raw);

  if (text === null) return refuse(deps, "Stryker wrote no readable report: the report file is missing");
  const json = parseJson(text);
  const scores = json.ok ? fromStryker(json.value) : json;

  return scores.ok ? scores.value : refuse(deps, `Stryker wrote no readable report: ${scores.reason}`);
}

/** A finished run: the shard's report and how many files it took. */
export type Ran = { report: ShardReport; files: number };

function mutateIn(base: string, plan: Plan, deps: MutateDeps): Ran | null {
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
  const installed = deps.run([...INSTALL_ARGS], clone);

  if (installed.code !== 0) return refuse(deps, `${INSTALL_COMMAND} failed in the clone: ${detail(installed)}`);
  const bin = strykerBin(clone, deps);
  const scores = bin === null ? null : stryker(base, { bin, files: mine }, deps);

  return scores === null ? null : ran(scores);
}

/** `mutate`'s result for the plan, run in a fresh dir under the OS temp dir, removed whether the run ends or throws. */
export function inTempDir(
  plan: Plan,
  deps: MutateDeps,
  mutate: (base: string, plan: Plan, deps: MutateDeps) => Ran | null,
): Ran | null {
  const base = deps.fs.mkdtemp(TEMP_PREFIX);

  try {
    return mutate(base, plan, deps);
  } finally {
    deps.fs.rm(base);
  }
}

/** The shard's scores from a run in a fresh clone under the OS temp dir, removed whether the run ends or throws. */
export function runInClone(plan: Plan, deps: MutateDeps): Ran | null {
  return inTempDir(plan, deps, mutateIn);
}
