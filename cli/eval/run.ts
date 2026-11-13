import { type Price, TOKENS_PER_MTOK } from "./price.constants.ts";
import type { EvalCase, ResolvedEval } from "./spec.ts";

/** What one model call answered and what it used. */
export type Completion = { text: string; inputTokens: number; outputTokens: number };

export type Complete = (input: string) => Promise<Completion>;

type CaseResult = { id: string; control: boolean; pass: boolean; fails: number; samples: number };

export type RunResult = { cases: CaseResult[]; spent: number };

/** The USD one call cost at `price`. */
function costOf(done: Completion, price: Price): number {
  return (done.inputTokens * price.input + done.outputTokens * price.output) / TOKENS_PER_MTOK;
}

/** One case sampled `samples` times: it passes when fewer than half the samples fail. */
async function runCase(
  one: EvalCase,
  spec: ResolvedEval,
  complete: Complete,
): Promise<{ done: Completion[]; result: CaseResult }> {
  const done = await Promise.all(Array.from({ length: spec.samples }, () => complete(one.input)));
  const fails = done.filter((each) => !one.pass(each.text)).length;
  const isPass = fails * 2 < spec.samples;

  return { done, result: { control: one.control === true, fails, id: one.id, pass: isPass, samples: spec.samples } };
}

type Job = { spec: ResolvedEval; complete: Complete; price: Price; run: RunResult };

/** The first case now and the rest after it, so no two cases overlap. */
async function runInOrder(cases: readonly EvalCase[], job: Job): Promise<void> {
  const [one, ...rest] = cases;

  if (one === undefined) return;
  const { done, result } = await runCase(one, job.spec, job.complete);

  job.run.cases.push(result);
  job.run.spent += done.reduce((sum, each) => sum + costOf(each, job.price), 0);
  await runInOrder(rest, job);
}

/** Runs the cases one after another, each case's samples together; `price` turns reported tokens into spend. */
export async function runEval(spec: ResolvedEval, complete: Complete, price: Price): Promise<RunResult> {
  const run: RunResult = { cases: [], spent: 0 };

  await runInOrder(spec.cases, { complete, price, run, spec });

  return run;
}
