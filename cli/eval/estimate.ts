import {
  CHARS_PER_TOKEN,
  DOLLAR_DECIMALS_LARGE,
  DOLLAR_DECIMALS_SMALL,
  PRICES,
  type Price,
  TOKENS_PER_MTOK,
} from "./price.constants.ts";
import type { ResolvedEval } from "./spec.ts";

export type Estimate =
  | { ok: true; calls: number; cost: number; price: Price; text: string }
  | { ok: false; message: string };

/** `$0.0187` under a dollar, `$1.00` from a dollar up. */
export function dollars(amount: number): string {
  return `$${amount.toFixed(amount < 1 ? DOLLAR_DECIMALS_SMALL : DOLLAR_DECIMALS_LARGE)}`;
}

/** The worst-case cost of every call and the one line saying so, or the refusal for an unknown model. */
export function estimate(name: string, spec: ResolvedEval, cap: number): Estimate {
  const price = PRICES.find(({ model }) => model === spec.model);

  if (price === undefined) {
    const known = PRICES.map(({ model }) => model).join(", ");

    return { message: `eval ${name}: unknown model ${spec.model}; known: ${known}`, ok: false };
  }

  const calls = spec.cases.length * spec.samples;
  let micro = 0;

  for (const one of spec.cases) {
    const tokens = Math.ceil((spec.system.length + one.input.length) / CHARS_PER_TOKEN);

    micro += spec.samples * (tokens * price.input + spec.maxTokens * price.output);
  }

  const cost = micro / TOKENS_PER_MTOK;
  const head = `eval ${name}: ${spec.cases.length} cases x ${spec.samples} samples = ${calls} calls on ${spec.model}`;

  return { calls, cost, ok: true, price, text: `${head}, at most ${dollars(cost)} (cap ${dollars(cap)})` };
}
