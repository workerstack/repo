import {
  DOLLAR_DECIMALS_LARGE,
  DOLLAR_DECIMALS_SMALL,
  FRAMING_TOKENS,
  PRICES,
  SESSION_FRAMING_TOKENS,
  type Price,
  TOKENS_PER_MTOK,
  type VIAS,
} from "./price.constants.ts";
import type { EvalCase, ResolvedEval } from "./spec.ts";

export type Estimate =
  | { ok: true; calls: number; cached: number; cost: number; price: Price; text: string }
  | { ok: false; message: string };

/** `$0.0187` under a dollar, `$1.00` from a dollar up. */
export function dollars(amount: number): string {
  return `$${amount.toFixed(amount < 1 ? DOLLAR_DECIMALS_SMALL : DOLLAR_DECIMALS_LARGE)}`;
}

/** How a call is paid: a logged-in `claude` session, or the Anthropic API on a key. */
export type Via = (typeof VIAS)[number];

/** What pays for a call: its model price, and the way it is sent. */
export type Pay = { price: Price; via: Via };

export type IsCached = (one: EvalCase, sample: number) => boolean;

/** Every sample is a miss. */
function never(): boolean {
  return false;
}

/** The cap to hold the estimate against, how the calls are paid and which samples the cache already answers. */
export type Limits = { cap: number; via: Via; isCached?: IsCached };

/**
 * The most one call of `one` can cost in USD: input bytes plus framing as input tokens, and `maxTokens` out; a
 * session call adds the hidden framing of Claude Code.
 */
export function callBound(spec: ResolvedEval, one: EvalCase, pay: Pay): number {
  const { price, via } = pay;
  const framing = via === "session" ? FRAMING_TOKENS + SESSION_FRAMING_TOKENS : FRAMING_TOKENS;
  const tokens = Buffer.byteLength(spec.system + one.input, "utf8") + framing;

  return (tokens * price.input + spec.maxTokens * price.output) / TOKENS_PER_MTOK;
}

/** How many samples of `one` the cache does not answer. */
export function missesOf(spec: ResolvedEval, one: EvalCase, isCached: IsCached): number {
  return Array.from({ length: spec.samples }, (_, sample) => sample).filter((sample) => !isCached(one, sample)).length;
}

/** The worst-case cost of every uncached call and the one line saying so, or the refusal for an unknown model. */
export function estimate(name: string, spec: ResolvedEval, limits: Limits): Estimate {
  const { cap, isCached = never, via } = limits;
  const price = PRICES.find(({ model }) => model === spec.model);

  if (price === undefined) {
    const known = PRICES.map(({ model }) => model).join(", ");

    return { message: `eval ${name}: unknown model ${spec.model}; known: ${known}`, ok: false };
  }

  const calls = spec.cases.length * spec.samples;
  const pay = { price, via };

  const each = spec.cases.map((one) => ({
    bound: callBound(spec, one, pay),
    misses: missesOf(spec, one, isCached),
  }));

  const cost = each.reduce((sum, { bound, misses }) => sum + misses * bound, 0);
  const cached = calls - each.reduce((sum, { misses }) => sum + misses, 0);
  const size = `${spec.cases.length} cases x ${spec.samples} samples = ${calls} calls`;
  const head = `eval ${name}: ${size} on ${spec.model} via ${via}`;
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
