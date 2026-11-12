/** One `repo mutate --rust` run in a throwaway clone of HEAD: `cargo mutants` over the workspace, then its outcomes. */
import path from "node:path";

import { z } from "zod";

import type { MutateDeps } from "./mutate-deps.ts";
import { fromCargoMutants, readParsed, type ShardReport } from "./mutate-report.ts";
import { checkout, inTempDir, refuse, type Plan, type Ran } from "./mutate-run.ts";
import { NEWLINE } from "./mutate.constants.ts";
import { CARGO_MUTANTS_PIN } from "./rust/cargo-tools.constants.ts";
import { pinProblem, quote } from "./rust/cargo-tools.ts";

const CLONE = "repo";
const OUT_DIR = "out";
const OUTCOMES = /* @__PURE__ */ path.join("mutants.out", "outcomes.json");

/** The exits that mean mutants ran: 0 all caught, 2 some missed, 3 some timed out. */
const RAN_EXITS: readonly (number | null)[] = [0, 2, 3];
const BASELINE_FAILED_EXIT = 4;
const LOCKED = "-C=--locked";

/** The `cargo mutants` arguments for the plan's shard (1-based here, 0-based for the tool), writing under `out`. */
export function mutantsArgs(plan: Plan, out: string): string[] {
  const { index, total } = plan.shard;
  const flags = [LOCKED, "--test-tool", "cargo", "--in-place", "--no-times", "--colors", "never"];

  return ["mutants", ...flags, "-o", out, "--shard", `${index - 1}/${total}`];
}

/** The first line of `text` that starts with `error`, else its first line, trimmed and cut short. */
function errorLine(text: string): string {
  const lines = text.split(NEWLINE).map((line) => line.trim());

  return quote(lines.find((line) => line.startsWith("error")) ?? lines.find((line) => line !== "") ?? "");
}

/** The per-file scores in the outcomes file under `out`, or null after printing why there are none. */
function scoresOf(out: string, deps: MutateDeps): ShardReport["files"] | null {
  const text = deps.fs.read(path.join(out, OUTCOMES));

  if (text === null) return refuse(deps, "cargo-mutants wrote no readable outcomes: the outcomes file is missing");
  // The outcomes are read twice: as JSON here, then by fromCargoMutants into per-file scores.
  const json = readParsed(z.json(), text);
  const scores = json.ok ? fromCargoMutants(json.value) : json;

  return scores.ok ? scores.value : refuse(deps, `cargo-mutants wrote no readable outcomes: ${scores.reason}`);
}

/** The mutants a report scored: killed plus surviving. */
function scored(files: ShardReport["files"]): number {
  return Object.values(files).reduce((sum, file) => sum + file.killed + file.survivors.length, 0);
}

function mutateIn(base: string, plan: Plan, deps: MutateDeps): Ran | null {
  const clone = path.join(base, CLONE);

  if (!checkout(clone, plan, deps)) return null;
  const problem = pinProblem(clone, deps.cargo, CARGO_MUTANTS_PIN);

  if (problem !== null) return refuse(deps, problem);
  const out = path.join(base, OUT_DIR);
  const result = deps.cargo(clone, mutantsArgs(plan, out));
  const said = result.stdout + result.stderr;

  if (result.status === BASELINE_FAILED_EXIT) {
    const extra = said.trim() === "" ? "" : `${said.trimEnd()}${NEWLINE}`;

    return refuse(deps, "the build or tests failed before any mutant ran; fix them first", extra);
  }

  if (!RAN_EXITS.includes(result.status)) {
    const why = errorLine(result.stderr === "" ? said : result.stderr);

    return refuse(deps, `cargo mutants exited ${result.status ?? "by signal"}: ${why}`);
  }

  const files = scoresOf(out, deps);

  if (files === null) return null;

  return { files: scored(files), report: { files, head: plan.sha, shard: plan.shard, tool: "cargo-mutants" } };
}

/**
 * The shard's scores from cargo-mutants in a fresh clone under the OS temp dir, removed whether the run ends or
 * throws; `files` counts the mutants it scored.
 */
export function runRust(plan: Plan, deps: MutateDeps): Ran | null {
  return inTempDir(plan, deps, mutateIn);
}
