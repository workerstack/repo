import { expect, it } from "vitest";

import { runEval } from "./run.ts";
import type { ResolvedEval } from "./spec.ts";

const HAIKU = { input: 0.1, output: 0.5 };

function pass(output: string): boolean {
  return output === "good";
}

/** Answers "bad" for the listed inputs' nth calls, "good" otherwise; reports 1000 in and 100 out tokens per call. */
function stub(badCalls: Record<string, number>) {
  const seen: Record<string, number> = {};

  return (input: string) => {
    seen[input] = (seen[input] ?? 0) + 1;
    const isBad = seen[input] <= (badCalls[input] ?? 0);

    return Promise.resolve({ inputTokens: 1000, outputTokens: 100, text: isBad ? "bad" : "good" });
  };
}

function spec(): ResolvedEval {
  return {
    cases: [
      { id: "one-bad", input: "a", pass, source: "s" },
      { id: "two-bad", input: "b", pass, source: "s" },
      { control: true, id: "ctl", input: "c", pass, source: "s" },
    ],
    maxTokens: 256,
    model: "claude-haiku-5-5",
    samples: 3,
    system: "sys",
  };
}

it("passes at 1 of 3 failing and fails at 2 of 3", async () => {
  const result = await runEval(spec(), stub({ a: 1, b: 2 }), HAIKU);

  expect(result.cases).toStrictEqual([
    { control: false, fails: 1, id: "one-bad", pass: true, samples: 3 },
    { control: false, fails: 2, id: "two-bad", pass: false, samples: 3 },
    { control: true, fails: 0, id: "ctl", pass: true, samples: 3 },
  ]);
});

it("sums spend from reported tokens times the model prices", async () => {
  const result = await runEval(spec(), stub({}), HAIKU);
  const perCall = (1000 * 0.1 + 100 * 0.5) / 1_000_000;

  expect(result.spent).toBeCloseTo(9 * perCall, 12);
});
