import {
  DOLLAR_DECIMALS_LARGE,
  DOLLAR_DECIMALS_SMALL,
  FRAMING_TOKENS,
  PRICES,
  type Price,
  TOKENS_PER_MTOK,
} from "./price.constants.ts";
import type { EvalCase, ResolvedEval } from "./spec.ts";

export type Estimate =
  | { ok: true; calls: number; cached: number; cost: number; price: Price; text: string }
  | { ok: false; message: string };

/** `$0.0187` under a dollar, `$1.00` from a dollar up. */
export function dollars(amount: number): string {
  return `$${amount.toFixed(amount < 1 ? DOLLAR_DECIMALS_SMALL : DOLLAR_DECIMALS_LARGE)}`;
}

export type IsCached = (one: EvalCase, sample: number) => boolean;

/** Every sample is a miss. */
function never(): boolean {
  return false;
}

/** The cap to hold the estimate against and which samples the cache already answers; none by default. */
export type Limits = { cap: number; isCached?: IsCached };

/** The most one call of `one` can cost in USD: input bytes plus framing as input tokens, and `maxTokens` out. */
export function callBound(spec: ResolvedEval, one: EvalCase, price: Price): number {
  const tokens = Buffer.byteLength(spec.system + one.input, "utf8") + FRAMING_TOKENS;

  return (tokens * price.input + spec.maxTokens * price.output) / TOKENS_PER_MTOK;
}

/** How many samples of `one` the cache does not answer. */
export function missesOf(spec: ResolvedEval, one: EvalCase, isCached: IsCached): number {
  return Array.from({ length: spec.samples }, (_, sample) => sample).filter((sample) => !isCached(one, sample)).length;
}

/** The worst-case cost of every uncached call and the one line saying so, or the refusal for an unknown model. */
export function estimate(name: string, spec: ResolvedEval, limits: Limits): Estimate {
  const { cap, isCached = never } = limits;
  const price = PRICES.find(({ model }) => model === spec.model);

  if (price === undefined) {
    const known = PRICES.map(({ model }) => model).join(", ");

    return { message: `eval ${name}: unknown model ${spec.model}; known: ${known}`, ok: false };
  }

  const calls = spec.cases.length * spec.samples;
  const each = spec.cases.map((one) => ({ bound: callBound(spec, one, price), misses: missesOf(spec, one, isCached) }));
  const cost = each.reduce((sum, { bound, misses }) => sum + misses * bound, 0);
  const cached = calls - each.reduce((sum, { misses }) => sum + misses, 0);
  const head = `eval ${name}: ${spec.cases.length} cases x ${spec.samples} samples = ${calls} calls on ${spec.model}`;
  const note = cached > 0 ? `, ${cached} cached` : "";

  return {
    cached,
    calls,
    cost,
    ok: true,
    price,
    text: `${head}${note}, at most ${dollars(cost)} (cap ${dollars(cap)})`,
  };
}
