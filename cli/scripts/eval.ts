/**
 * `repo eval <name> [--dry-run] [--max-cost <usd>]`: loads `evals/<name>/eval.ts`, prints the worst-case cost,
 * refuses over the cap (default $1.00), and otherwise runs every case through the Anthropic API and prints pass or
 * fail per case with the spend. `--dry-run` stops after the estimate and never reads `ANTHROPIC_API_KEY`. Exits 0
 * when it ran, 1 when it refused or a call failed, 4 on a bad argument.
 */
import { createClient, type FetchFn } from "../eval/client.ts";
import { dollars, estimate } from "../eval/estimate.ts";
import { loadEval } from "../eval/load.ts";
import type { Price } from "../eval/price.constants.ts";
import { runEval, type RunResult } from "../eval/run.ts";
import type { ResolvedEval } from "../eval/spec.ts";
import { repoEnv, type Env } from "../repo-env.ts";
import { errorMessage } from "../sync-errors.ts";
import { parseArgs, type Args } from "./eval-args.ts";
import { DRY_RUN_FLAG, EXIT_FAILED, EXIT_OK, MAX_COST_FLAG } from "./eval.constants.ts";

/** Where `repo eval` runs and what it reads and prints through; real ones by default. */
export type EvalDeps = {
  root?: string;
  fetchFn?: FetchFn;
  /** Read for `ANTHROPIC_API_KEY` only when a real run starts. */
  env?: Pick<Env, "ANTHROPIC_API_KEY">;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
};

type Io = Required<EvalDeps>;

type Plan = { spec: ResolvedEval; price: Price; cap: number; text: string };

function realIo(): Io {
  return {
    env: repoEnv.process,
    fetchFn: fetch,
    root: process.cwd(),
    stderr: process.stderr.write.bind(process.stderr),
    stdout: process.stdout.write.bind(process.stdout),
  };
}

/** One `pass <id>` or `fail <id>` line per case, then the spend against the cap. */
function report(run: RunResult, cap: number): string {
  const lines = run.cases.map((one) => `${one.pass ? "pass" : "fail"} ${one.id}${one.control ? " (control)" : ""}`);

  return `${lines.join("\n")}\nspent ${dollars(run.spent)} of ${dollars(cap)}\n`;
}

/** Runs every case through the API; a failed call is one line and exit 1. */
async function runReal(io: Io, plan: Plan, apiKey: string): Promise<number> {
  const { spec } = plan;
  const config = { apiKey, maxTokens: spec.maxTokens, model: spec.model, system: spec.system };

  try {
    io.stdout(report(await runEval(spec, createClient(io.fetchFn, config), plan.price), plan.cap));

    return EXIT_OK;
  } catch (error) {
    io.stderr(`${errorMessage(error)}\n`);

    return EXIT_FAILED;
  }
}

/** The loaded eval and its estimate, or the line that refuses it: unknown eval, unknown model or over the cap. */
async function prepare(root: string, args: Args): Promise<{ ok: true; plan: Plan } | { ok: false; line: string }> {
  const { cap, name } = args;
  const loaded = await loadEval(root, name);

  if (!loaded.ok) return { line: loaded.message, ok: false };
  const found = estimate(name, loaded.spec, cap);

  if (!found.ok) return { line: found.message, ok: false };

  if (found.cost > cap) {
    const over = `at most ${dollars(found.cost)} is over the cap ${dollars(cap)}`;

    return { line: `eval ${name}: ${over}; raise it with ${MAX_COST_FLAG} <usd>`, ok: false };
  }

  return { ok: true, plan: { cap, price: found.price, spec: loaded.spec, text: found.text } };
}

export async function main(argv: string[], deps?: EvalDeps): Promise<number> {
  const io: Io = { ...realIo(), ...deps };
  const parsed = parseArgs(argv);

  if (!parsed.ok) {
    io.stderr(`${parsed.line}\n`);

    return parsed.code;
  }

  const planned = await prepare(io.root, parsed.args);

  if (!planned.ok) {
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
