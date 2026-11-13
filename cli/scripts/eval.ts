/**
 * `repo eval <name> [--dry-run] [--max-cost <usd>] [--changed <base>]`: loads `evals/<name>/eval.ts`; with
 * `--changed`, prints the first file it reads that changed since the merge base with `<base>`, or that none did and
 * exits 0 there. Then it prints the worst-case cost of its
 * uncached calls, refuses over the cap (default $1.00), and otherwise runs every case through the Anthropic API and
 * prints pass or fail per case with the spend. Answers are cached under `.repo/tmp/evals/cache` of the main checkout,
 * so a rerun of unchanged text costs nothing; the run stops before a case whose bound would cross the cap, and every
 * run that started leaves a JSON summary under `.repo/tmp/evals/runs`. `--dry-run` stops after the estimate and never
 * reads `ANTHROPIC_API_KEY`. Exits 0 when every case ran, 1 when it refused, stopped or a call failed, 4 on a bad
 * argument.
 */
import path from "node:path";

import { openCache } from "../eval/cache.ts";
import { changedFiles, firstChanged } from "../eval/changed.ts";
import { createClient, type FetchFn } from "../eval/client.ts";
import { dollars, estimate } from "../eval/estimate.ts";
import { loadEval } from "../eval/load.ts";
import type { Price } from "../eval/price.constants.ts";
import { runEval, sampleKey, type RunResult } from "../eval/run.ts";
import type { ResolvedEval } from "../eval/spec.ts";
import { writeSummary } from "../eval/summary.ts";
import { repoEnv, type Env } from "../repo-env.ts";
import { parseArgs, type Args } from "./eval-args.ts";
import {
  CACHE_DIR,
  CHANGED_FLAG,
  DRY_RUN_FLAG,
  EVALS_DIR,
  EXIT_FAILED,
  EXIT_OK,
  MAX_COST_FLAG,
  RUNS_DIR,
} from "./eval.constants.ts";
import { resolveRoots } from "./workspace-root.ts";

/**
 * Where `repo eval` runs, keeps its cache and summaries, and what it reads and prints through; real ones by default.
 */
export type EvalDeps = {
  root?: string;
  /** The folder that holds `cache/` and `runs/`; the main checkout's `.repo/tmp/evals` by default. */
  state?: string;
  now?: () => Date;
  fetchFn?: FetchFn;
  /** Read for `ANTHROPIC_API_KEY` only when a real run starts. */
  env?: Pick<Env, "ANTHROPIC_API_KEY">;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** The paths changed since the merge base with `base`, or null when git cannot diff against it. */
  changedSince?: (root: string, base: string) => string[] | null;
};

type Io = Required<EvalDeps>;

type Plan = { name: string; spec: ResolvedEval; price: Price; cap: number; cost: number; text: string };

/** A planned run, a refusal (exit 1), or an eval that reads nothing changed (exit 0); each with what it prints. */
type Prepared = { kind: "plan"; plan: Plan } | { kind: "refused"; line: string } | { kind: "unchanged"; line: string };

/** Under `--changed`: the line naming the first changed file the eval reads, or why it does not run. */
type Selected = { kind: "run"; line: string } | Exclude<Prepared, { kind: "plan" }>;

function realIo(deps: EvalDeps | undefined): Io {
  return {
    changedSince: changedFiles,
    env: repoEnv.process,
    fetchFn: fetch,
    now: () => new Date(),
    root: process.cwd(),
    state: deps?.state ?? path.join(resolveRoots().root, EVALS_DIR),
    stderr: process.stderr.write.bind(process.stderr),
    stdout: process.stdout.write.bind(process.stdout),
  };
}

/** One `pass <id>` or `fail <id>` line per case that ran, then the spend and, when any, the cached calls. */
function report(run: RunResult, cap: number): string {
  const lines = run.cases.map((one) => `${one.pass ? "pass" : "fail"} ${one.id}${one.control ? " (control)" : ""}`);
  const total = run.calls + run.cached;
  const hits = run.cached > 0 ? `, ${run.cached} of ${total} calls cached` : "";

  return [...lines, `spent ${dollars(run.spent)} of ${dollars(cap)}${hits}`].map((line) => `${line}\n`).join("");
}

/** Why the run did not finish, or nothing when every case ran. */
function endLine(plan: Plan, run: RunResult): string | undefined {
  if (run.end.kind === "failed") return run.end.message;

  if (run.end.kind === "stopped") {
    const after = `after ${run.cases.length} of ${plan.spec.cases.length} cases`;

    return `eval ${plan.name}: stopped at the cap ${dollars(plan.cap)} ${after}; raise it with ${MAX_COST_FLAG} <usd>`;
  }

  return undefined;
}

/** Runs the cases through the API and the cache, prints the report and the summary path, then why it ended early. */
async function runReal(io: Io, plan: Plan, apiKey: string): Promise<number> {
  const { spec } = plan;
  const config = { apiKey, maxTokens: spec.maxTokens, model: spec.model, system: spec.system };
  const job = { cache: openCache(path.join(io.state, CACHE_DIR)), cap: plan.cap, price: plan.price };

  const run = await runEval(spec, { ...job, complete: createClient(io.fetchFn, config) });
  const summary = { cap: plan.cap, estimate: plan.cost, eval: plan.name, model: spec.model, run };
  const file = writeSummary(path.join(io.state, RUNS_DIR), summary, io.now());
  const why = endLine(plan, run);

  io.stdout(`${report(run, plan.cap)}summary ${file}\n`);

  if (why !== undefined) io.stderr(`${why}\n`);

  return why === undefined ? EXIT_OK : EXIT_FAILED;
}

/** Whether eval `name`, reading `spec.files`, runs: always without `--changed`, else when a file it reads changed. */
function select(io: Io, { changed: base, name }: Args, spec: ResolvedEval): Selected {
  if (base === undefined) return { kind: "run", line: "" };
  const changed = io.changedSince(io.root, base);

  if (changed === null) return { kind: "refused", line: `eval: ${CHANGED_FLAG}: git cannot diff against "${base}"` };
  const found = firstChanged(name, spec.files, changed);

  if (found === undefined) return { kind: "unchanged", line: `eval ${name}: nothing it reads changed since ${base}` };

  return { kind: "run", line: `eval ${name}: ${found} changed since ${base}\n` };
}

/**
 * The loaded eval and its estimate, or the line that refuses it (unknown eval, bad base, unknown model or over the
 * cap), or says nothing it reads changed.
 */
async function prepare(io: Io, args: Args): Promise<Prepared> {
  const { cap, name } = args;
  const loaded = await loadEval(io.root, name);

  if (!loaded.ok) return { kind: "refused", line: loaded.message };
  const { spec } = loaded;
  const selected = select(io, args, spec);

  if (selected.kind !== "run") return selected;
  const cache = openCache(path.join(io.state, CACHE_DIR));

  const found = estimate(name, spec, {
    cap,
    isCached(one, sample) {
      return cache.get(sampleKey(spec, one, sample)) !== undefined;
    },
  });

  if (!found.ok) return { kind: "refused", line: found.message };

  if (found.cost > cap) {
    const over = `at most ${dollars(found.cost)} is over the cap ${dollars(cap)}`;

    return { kind: "refused", line: `eval ${name}: ${over}; raise it with ${MAX_COST_FLAG} <usd>` };
  }

  const text = `${selected.line}${found.text}`;

  return { kind: "plan", plan: { cap, cost: found.cost, name, price: found.price, spec, text } };
}

export async function main(argv: string[], deps?: EvalDeps): Promise<number> {
  const io: Io = { ...realIo(deps), ...deps };
  const parsed = parseArgs(argv);

  if (!parsed.ok) {
    io.stderr(`${parsed.line}\n`);

    return parsed.code;
  }

  const planned = await prepare(io, parsed.args);

  if (planned.kind === "unchanged") {
    io.stdout(`${planned.line}\n`);

    return EXIT_OK;
  }

  if (planned.kind === "refused") {
    io.stderr(`${planned.line}\n`);

    return EXIT_FAILED;
  }

  io.stdout(`${planned.plan.text}\n`);

  if (parsed.args.isDryRun) return EXIT_OK;
  const apiKey = io.env.ANTHROPIC_API_KEY;

  if (apiKey === undefined || apiKey === "") {
    io.stderr(`eval: set ANTHROPIC_API_KEY to run; ${DRY_RUN_FLAG} needs none\n`);

    return EXIT_FAILED;
  }

  return runReal(io, planned.plan, apiKey);
}
