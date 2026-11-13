import { expect, it } from "vitest";

import { estimate } from "./estimate.ts";
import type { ResolvedEval } from "./spec.ts";

function pass(): boolean {
  return true;
}

function spec(change: Partial<ResolvedEval> = {}): ResolvedEval {
  return {
    cases: [
      { id: "a", input: "x".repeat(29), pass, source: "s" },
      { id: "b", input: "y".repeat(60), pass, source: "s" },
    ],
    maxTokens: 256,
    model: "claude-haiku-5-5",
    samples: 3,
    system: "z".repeat(1),
    ...change,
  };
}

/** Case a is 30 chars (10 tokens), case b is 61 chars (21 tokens). */
const EXPECTED_HAIKU = (3 * (10 * 0.1 + 256 * 0.5 + (21 * 0.1 + 256 * 0.5))) / 1_000_000;

it("estimates cases x samples by the formula", () => {
  const result = estimate("demo", spec(), 1);

  if (!result.ok) throw new Error(result.message);
  expect(result.calls).toBe(6);
  expect(result.cost).toBeCloseTo(EXPECTED_HAIKU, 12);
});

it("rises with maxTokens", () => {
  const low = estimate("demo", spec(), 1);
  const high = estimate("demo", spec({ maxTokens: 512 }), 1);

  if (!low.ok || !high.ok) throw new Error("expected ok");
  expect(high.cost).toBeGreaterThan(low.cost);
});

it("prints the one line", () => {
  const result = estimate("demo", spec(), 1);

  if (!result.ok) throw new Error(result.message);
  expect(result.text).toBe("eval demo: 2 cases x 3 samples = 6 calls on claude-haiku-5-5, at most $0.0008 (cap $1.00)");
});

it("prices other models and formats dollars of 1 or more with 2 decimals", () => {
  const result = estimate("demo", spec({ maxTokens: 1_000_000, model: "claude-opus-5-5" }), 1);

  if (!result.ok) throw new Error(result.message);
  expect(result.text).toContain("at most $120.00 (cap $1.00)");
});

it("refuses an unknown model and names the known ones", () => {
  const result = estimate("demo", spec({ model: "gpt-x" }), 1);

  expect(result).toStrictEqual({
    message: "eval demo: unknown model gpt-x; known: claude-haiku-5-5, claude-opus-5-5, claude-sonnet-5-5",
    ok: false,
  });
});
