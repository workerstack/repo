import { expect, it } from "vitest";

import { callBound, estimate, type Via } from "./estimate.ts";
import { FRAMING_TOKENS, PRICES, SESSION_FRAMING_TOKENS } from "./price.constants.ts";
import type { ResolvedEval } from "./spec.ts";

/** Only sample 0 of case a is cached. */
function firstOfA(one: { id: string }, sample: number): boolean {
  return one.id === "a" && sample === 0;
}

function pass(): boolean {
  return true;
}

function spec(change: Partial<ResolvedEval> = {}): ResolvedEval {
  return {
    cases: [
      { id: "a", input: "x".repeat(29), pass, source: "s" },
      { id: "b", input: "y".repeat(60), pass, source: "s" },
    ],
    files: [],
    maxTokens: 256,
    model: "claude-haiku-5-5",
    samples: 3,
    system: "z".repeat(1),
    ...change,
  };
}

/** Case a is 30 bytes, case b is 61 bytes, each plus the framing tokens per call. */
const EXPECTED_HAIKU =
  (3 * ((30 + FRAMING_TOKENS) * 0.1 + 256 * 0.5 + ((61 + FRAMING_TOKENS) * 0.1 + 256 * 0.5))) / 1_000_000;

/** The haiku price paid `via`. */
function bill(via: Via) {
  return { price: haiku(), via };
}

/** The haiku price row. */
function haiku() {
  const found = PRICES.find(({ model }) => model === "claude-haiku-5-5");

  if (found === undefined) throw new Error("no haiku price");

  return found;
}

it("estimates cases x samples by the formula", () => {
  const result = estimate("demo", spec(), { cap: 1, via: "api" });

  if (!result.ok) throw new Error(result.message);
  expect(result.calls).toBe(6);
  expect(result.cost).toBeCloseTo(EXPECTED_HAIKU, 12);
});

it("rises with maxTokens", () => {
  const low = estimate("demo", spec(), { cap: 1, via: "api" });
  const high = estimate("demo", spec({ maxTokens: 512 }), { cap: 1, via: "api" });

  if (!low.ok || !high.ok) throw new Error("expected ok");
  expect(high.cost).toBeGreaterThan(low.cost);
});

it("prints the one line", () => {
  const result = estimate("demo", spec(), { cap: 1, via: "api" });

  if (!result.ok) throw new Error(result.message);
  expect(result.text).toBe(
    "eval demo: 2 cases x 3 samples = 6 calls on claude-haiku-5-5 via api, at most $0.0008 (cap $1.00)",
  );
});

it("prices other models and formats dollars of 1 or more with 2 decimals", () => {
  const result = estimate("demo", spec({ maxTokens: 1_000_000, model: "claude-opus-5-5" }), { cap: 1, via: "api" });

  if (!result.ok) throw new Error(result.message);
  expect(result.text).toContain("at most $120.00 (cap $1.00)");
});

it("refuses an unknown model and names the known ones", () => {
  const result = estimate("demo", spec({ model: "gpt-x" }), { cap: 1, via: "api" });

  expect(result).toStrictEqual({
    message: "eval demo: unknown model gpt-x; known: claude-haiku-5-5, claude-opus-5-5, claude-sonnet-5-5",
    ok: false,
  });
});

it("bounds input by UTF-8 bytes, not chars / 3", () => {
  const emoji = "\u{1F600}".repeat(30);
  const base = spec();
  const one = { id: "e", input: emoji, pass, source: "s" };
  const two = { id: "e", input: "x".repeat(30), pass, source: "s" };

  expect(Buffer.byteLength(emoji, "utf8")).toBe(120);
  expect(callBound(base, one, bill("api"))).toBeGreaterThan(callBound(base, two, bill("api")));
  expect(callBound(base, one, bill("api"))).toBeCloseTo(((120 + 1 + FRAMING_TOKENS) * 0.1 + 256 * 0.5) / 1_000_000, 12);
});

it("costs nothing for cached calls and says how many", () => {
  const result = estimate("demo", spec(), { cap: 1, isCached: () => true, via: "api" });

  if (!result.ok) throw new Error(result.message);
  expect(result.cost).toBe(0);
  expect(result.cached).toBe(6);
  expect(result.text).toBe(
    "eval demo: 2 cases x 3 samples = 6 calls on claude-haiku-5-5 via api, 6 cached, at most $0.0000 (cap $1.00)",
  );
});

it("counts only the cached samples as free", () => {
  const result = estimate("demo", spec(), { cap: 1, isCached: firstOfA, via: "api" });
  const full = estimate("demo", spec(), { cap: 1, via: "api" });

  if (!result.ok || !full.ok) throw new Error("expected ok");
  expect(result.cached).toBe(1);
  expect(result.cost).toBeLessThan(full.cost);
  expect(result.text).toContain("= 6 calls on claude-haiku-5-5 via api, 1 cached, at most");
});

it("bounds a session call at the API bound plus the session's hidden input tokens", () => {
  const one = spec().cases[0];

  if (one === undefined) throw new Error("no case");
  const extra = (SESSION_FRAMING_TOKENS * haiku().input) / 1_000_000;

  expect(SESSION_FRAMING_TOKENS).toBe(1500);
  expect(callBound(spec(), one, bill("session"))).toBeCloseTo(callBound(spec(), one, bill("api")) + extra, 12);
});

it("says via session on a session estimate and costs 1500 input tokens more a call", () => {
  const session = estimate("demo", spec(), { cap: 1, via: "session" });
  const api = estimate("demo", spec(), { cap: 1, via: "api" });

  if (!session.ok || !api.ok) throw new Error("expected ok");
  expect(session.text).toContain("= 6 calls on claude-haiku-5-5 via session, at most");
  expect(api.text).toContain("= 6 calls on claude-haiku-5-5 via api, at most");
  expect(session.cost - api.cost).toBeCloseTo((6 * SESSION_FRAMING_TOKENS * 0.1) / 1_000_000, 12);
});
