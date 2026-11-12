/**
 * `repo mutate`: runs StrykerJS under bun (or, with `--rust`, cargo-mutants over the Cargo workspace), in place, in a
 * throwaway `git clone --shared` of HEAD so no mutant can touch the checkout, over the tracked files matching
 * `coverage.mutate` or shard `i/n` of them, and writes a report of every file's kills and survivors. A whole run
 * holds each package to its floor in `coverage.mutationFloors`; a shard checks none, and `check <dir>` merges a
 * run's shard reports and does. A typed path is relative to the current directory; the default report is under the
 * repo root.
 */
import path from "node:path";

import { checkReports } from "./check-reports.ts";
import { parseArgs, type Args, type Shard } from "./mutate-args.ts";
import { fail, type MutateConfig, type MutateDeps } from "./mutate-deps.ts";
import { selectFiles } from "./mutate-files.ts";
import { judgeRun, plural } from "./mutate-floors.ts";
import { realDeps } from "./mutate-real-deps.ts";
import { survivorCount } from "./mutate-report.ts";
import { runInClone, type Ran } from "./mutate-run.ts";
import { runRust } from "./mutate-rust.ts";
import {
  DEFAULT_REPORT,
  CARGO_MANIFEST,
  FAILED,
  RUST_FLAG,
  JSON_INDENT,
  NEWLINE,
  OK,
  SHORT_SHA,
} from "./mutate.constants.ts";
import type { Result } from "./result.ts";

const NOTE = "(uncommitted changes are not mutated)";
const NO_CARGO = `${RUST_FLAG} needs a Cargo.toml at the repo root`;

function whole(shard: Shard): boolean {
  return shard.total === 1;
}

type Run = Extract<Args, { kind: "run" }>;

type Found = { sha: string; files: string[] };

/** The commit to mutate and the tracked files, after saying the commit; or the failing exit code. */
function headOf(config: MutateConfig, deps: MutateDeps): Result<{ sha: string; tracked: string[] }, number> {
  const head = deps.git(config.root, ["rev-parse", "HEAD"]);

  const none = `${config.root} has no commit to mutate: ${head.stderr.trim()}`;

  if (head.code !== 0) return { error: fail(deps, none), ok: false };
  const sha = head.stdout.trim();
  const isDirty = deps.git(config.root, ["status", "--porcelain"]).stdout.trim() !== "";
  deps.out(`mutate: HEAD ${sha.slice(0, SHORT_SHA)}${isDirty ? ` ${NOTE}` : ""}${NEWLINE}`);
  const tracked = deps.git(config.root, ["ls-tree", "-r", "--name-only", "HEAD"]).stdout.split(NEWLINE);

  return { ok: true, value: { sha, tracked } };
}

/**
 * The commit to mutate and the tracked files matching `coverage.mutate`, none needed for cargo-mutants; or the
 * failing exit code.
 */
function target(config: MutateConfig, run: Run, deps: MutateDeps): Result<Found, number> {
  const head = headOf(config, deps);

  if (!head.ok) return head;
  const { sha, tracked } = head.value;

  if (run.tool === "cargo-mutants") return { ok: true, value: { files: [], sha } };
  const files = selectFiles(tracked, config.mutate);

  if (files.length > 0) return { ok: true, value: { files, sha } };
  const globs = config.mutate.join(", ");
  const line = `no tracked file matches coverage.mutate (${globs}); set coverage.mutate in workerstack.config.ts`;

  return { error: fail(deps, line), ok: false };
}

/** The line after a shard: what it took, its survivors and where they are. */
function shardLine(run: Run, ran: Ran, shown: string): string {
  const { index, total } = run.shard;
  const survivors = plural(survivorCount(ran.report.files), "survivor");
  const took = run.tool === "cargo-mutants" ? "cargo-mutants" : plural(ran.files, "file");

  return `mutate: ${took}, shard ${index}/${total}, ${survivors} in ${shown}${NEWLINE}`;
}

/** A run's report path as typed (or the default), where it is written, and the plan it follows. */
function paths(run: Run, config: MutateConfig, deps: MutateDeps) {
  const shown = run.report ?? DEFAULT_REPORT;

  return { file: run.report === undefined ? path.join(config.root, shown) : path.resolve(deps.cwd, shown), shown };
}

/** Runs the tool over the commit in a clone, writes its report and, for a whole run, judges it; the exit code. */
function execute(run: Run, setup: { config: MutateConfig; found: Found }, deps: MutateDeps): number {
  const { config, found } = setup;
  const isRust = run.tool === "cargo-mutants";
  const { shard } = run;

  if (whole(shard) && !isRust) deps.out(`mutate: ${plural(found.files.length, "file")}, shard 1/1${NEWLINE}`);
  const plan = { files: found.files, root: config.root, sha: found.sha, shard };
  const ran = isRust ? runRust(plan, deps) : runInClone(plan, deps);

  if (ran === null) return FAILED;
  const where = paths(run, config, deps);
  deps.fs.write(where.file, `${JSON.stringify(ran.report, null, JSON_INDENT)}${NEWLINE}`);

  if (!whole(shard)) {
    deps.out(shardLine(run, ran, where.shown));

    return OK;
  }

  if (isRust) deps.out(`mutate: cargo-mutants, ${plural(ran.files, "mutant")}, shard 1/1${NEWLINE}`);

  return judgeRun({ config, report: ran.report, shown: where.shown }, deps);
}

async function runShard(run: Run, deps: MutateDeps): Promise<number> {
  const config = await deps.config(deps.cwd);

  if (Array.isArray(config)) return fail(deps, ...config);

  if (run.tool === "cargo-mutants" && deps.fs.read(path.join(config.root, CARGO_MANIFEST)) === null)
    return fail(deps, NO_CARGO);

  const found = target(config, run, deps);

  return found.ok ? execute(run, { config, found: found.value }, deps) : found.error;
}

/** `repo mutate` with its collaborators injected; the exit code. */
export function runMutate(argv: string[], deps: MutateDeps): Promise<number> {
  const args = parseArgs(argv);

  if (args.kind === "error") return Promise.resolve(fail(deps, args.line));

  return args.kind === "check" ? checkReports({ dir: args.dir, write: args.write }, deps) : runShard(args, deps);
}

/** The registry entry: `repo mutate` in the current directory. */
export function main(argv: string[]): Promise<number> {
  return runMutate(argv, realDeps(process.cwd()));
}
