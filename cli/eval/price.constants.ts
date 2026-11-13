/** A model's price in USD per million tokens. */
export type Price = { readonly input: number; readonly output: number };

export type ModelPrice = Price & { readonly model: string };

const HAIKU_INPUT = 0.1;
const HAIKU_OUTPUT = 0.5;
const SONNET_INPUT = 2;
const SONNET_OUTPUT = 10;
const OPUS_INPUT = 4;
const OPUS_OUTPUT = 20;

/** USD per MTok, from https://platform.claude.com/docs/en/about-claude/pricing on 2026-11-13. */
export const PRICES: readonly ModelPrice[] = [
  { input: HAIKU_INPUT, model: "claude-haiku-5-5", output: HAIKU_OUTPUT },
  { input: OPUS_INPUT, model: "claude-opus-5-5", output: OPUS_OUTPUT },
  { input: SONNET_INPUT, model: "claude-sonnet-5-5", output: SONNET_OUTPUT },
];

export const DEFAULT_MODEL = "claude-haiku-5-5";
export const DEFAULT_SAMPLES = 3;
export const DEFAULT_MAX_TOKENS = 256;

/** Tokens added to every call's input bound; covers role and message framing the bytes do not. */
export const FRAMING_TOKENS = 32;
export const TOKENS_PER_MTOK = 1_000_000;
export const DOLLAR_DECIMALS_SMALL = 4;
export const DOLLAR_DECIMALS_LARGE = 2;
