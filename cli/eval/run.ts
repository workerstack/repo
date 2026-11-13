import { errorMessage } from "../sync-errors.ts";
import { type Cache, cacheKey } from "./cache.ts";
import { callBound, type IsCached, missesOf } from "./estimate.ts";
import { type Price, TOKENS_PER_MTOK } from "./price.constants.ts";
import type { EvalCase, ResolvedEval } from "./spec.ts";

/** What one model call answered and what it used. */
export type Completion = { text: string; inputTokens: number; outputTokens: number };

export type Complete = (input: string) => Promise<Completion>;

export type CaseResult = { id: string; control: boolean; pass: boolean; fails: number; samples: number };

/** How a run ended: every case ran, the cap stopped it before a case, or a call failed. */
export type RunEnd = { kind: "done" } | { kind: "stopped" } | { kind: "failed"; message: string };

/** The cases that ran, what they cost, how many calls were paid for or served from the cache, and the end. */
export type RunResult = { cases: CaseResult[]; spent: number; calls: number; cached: number; end: RunEnd };

/** What a run needs besides the spec: the model call, its prices, the cap and the cache. */
export type RunJob = { complete: Complete; price: Price; cap: number; cache: Cache };

/** The cache key of one sample of one case. */
export function sampleKey(spec: ResolvedEval, one: EvalCase, sample: number): string {
  const { maxTokens, model, system } = spec;

  return cacheKey({ input: one.input, maxTokens, model, sample, system });
}

/** The USD one call cost at `price`. */
function costOf(done: Completion, price: Price): number {
  return (done.inputTokens * price.input + done.outputTokens * price.output) / TOKENS_PER_MTOK;
}

/** The spec and the job one run works through. */
type Ctx = { spec: ResolvedEval; job: RunJob };

/** One sample: the cached answer, or a call whose answer is cached right after it returns. */
async function takeSample(ctx: Ctx, one: EvalCase, index: number): Promise<{ done: Completion; isHit: boolean }> {
  const key = sampleKey(ctx.spec, one, index);
  const hit = ctx.job.cache.get(key);

  if (hit !== undefined) return { done: hit, isHit: true };
  const done = await ctx.job.complete(one.input);

  ctx.job.cache.set(key, done);

  return { done, isHit: false };
}

/** Counts a settled batch into the run and returns the first failure message, if any. */
function tally(run: RunResult, settled: PromiseSettledResult<{ done: Completion; isHit: boolean }>[], job: RunJob) {
  const failed: string[] = [];
  const kept: Completion[] = [];

  for (const each of settled) {
    if (each.status === "rejected") {
      run.calls += 1;
      failed.push(errorMessage(each.reason));
    } else if (each.value.isHit) {
      run.cached += 1;
      kept.push(each.value.done);
    } else {
      run.calls += 1;
      run.spent += costOf(each.value.done, job.price);
      kept.push(each.value.done);
    }
  }

  return { failed: failed[0], kept };
}

/** Whether the cache answers sample `index` of `one`. */
function cachedIn(ctx: Ctx): IsCached {
  return function isCached(one, index) {
    return ctx.job.cache.get(sampleKey(ctx.spec, one, index)) !== undefined;
  };
}

/** The first case now and the rest after it, so no two cases overlap. */
async function runInOrder(ctx: Ctx, cases: readonly EvalCase[], run: RunResult): Promise<void> {
  const [one, ...rest] = cases;

  if (one === undefined) return;
  const { job, spec } = ctx;

  if (run.spent + missesOf(spec, one, cachedIn(ctx)) * callBound(spec, one, job.price) > job.cap) {
    run.end = { kind: "stopped" };

    return;
  }

  const settled = await Promise.allSettled(Array.from({ length: spec.samples }, (_, i) => takeSample(ctx, one, i)));
  const { failed, kept } = tally(run, settled, job);

  if (failed !== undefined) {
    run.end = { kind: "failed", message: failed };

    return;
  }

  const fails = kept.filter((each) => !one.pass(each.text)).length;

  run.cases.push({
    control: one.control === true,
    fails,
    id: one.id,
    pass: fails * 2 < spec.samples,
    samples: spec.samples,
  });
  await runInOrder(ctx, rest, run);
}

/**
 * Runs the cases one after another, each case's samples together; stops before a case whose bound would cross the
 * cap.
 */
export async function runEval(spec: ResolvedEval, job: RunJob): Promise<RunResult> {
  const run: RunResult = { cached: 0, calls: 0, cases: [], end: { kind: "done" }, spent: 0 };

  await runInOrder({ job, spec }, spec.cases, run);

  return run;
}
