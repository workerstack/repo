import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { removeTree } from "../remove-tree.ts";
import { cacheKey, openCache } from "./cache.ts";
import type { Via } from "./estimate.ts";
import { FRAMING_TOKENS } from "./price.constants.ts";
import { runEval, sampleKey } from "./run.ts";
import type { ResolvedEval } from "./spec.ts";

const HAIKU = { input: 0.1, output: 0.5 };
const PER_CALL = (1000 * 0.1 + 100 * 0.5) / 1_000_000;
let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-run-"));
});

afterEach(() => {
  removeTree(dir);
});

function long() {
  return Promise.resolve({ inputTokens: 1000, outputTokens: 5000, text: "good" });
}

function pass(output: string): boolean {
  return output === "good";
}

/** Answers "bad" for the listed inputs' nth calls, "good" otherwise; reports 1000 in and 100 out tokens per call. */
function stub(badCalls: Record<string, number>, inputTokens = 1000) {
  const seen: Record<string, number> = {};
  const calls: string[] = [];

  function complete(input: string) {
    calls.push(input);
    seen[input] = (seen[input] ?? 0) + 1;
    const isBad = seen[input] <= (badCalls[input] ?? 0);

    return Promise.resolve({ inputTokens, outputTokens: 100, text: isBad ? "bad" : "good" });
  }

  return { calls, complete };
}

function spec(change: Partial<ResolvedEval> = {}): ResolvedEval {
  return {
    cases: [
      { id: "one-bad", input: "a", pass, source: "s" },
      { id: "two-bad", input: "b", pass, source: "s" },
      { control: true, id: "ctl", input: "c", pass, source: "s" },
    ],
    files: [],
    maxTokens: 256,
    model: "claude-haiku-5-5",
    samples: 3,
    system: "sys",
    ...change,
  };
}

function job(
  complete: (input: string) => Promise<never> | Promise<{ inputTokens: number; outputTokens: number; text: string }>,
  cap = 1,
  via: Via = "api",
) {
  return { cache: openCache(dir), cap, complete, price: HAIKU, via };
}

it("passes at 1 of 3 failing and fails at 2 of 3", async () => {
  const result = await runEval(spec(), job(stub({ a: 1, b: 2 }).complete));

  expect(result.cases).toStrictEqual([
    { control: false, fails: 1, id: "one-bad", pass: true, samples: 3 },
    { control: false, fails: 2, id: "two-bad", pass: false, samples: 3 },
    { control: true, fails: 0, id: "ctl", pass: true, samples: 3 },
  ]);
  expect(result).toMatchObject({ cached: 0, calls: 9, end: { kind: "done" } });
});

it("sums spend from reported tokens times the model prices", async () => {
  const result = await runEval(spec(), job(stub({}).complete));

  expect(result.spent).toBeCloseTo(9 * PER_CALL, 12);
});

it("stops before the case that would cross, even when the stub reports more than chars / 3", async () => {
  const model = stub({}, 100_000);
  const bound = (4 + FRAMING_TOKENS) * 0.1 + 256 * 0.5;
  const oneCase = (3 * bound) / 1_000_000;
  const cap = oneCase * 1.5;
  const result = await runEval(spec(), job(model.complete, cap));

  expect(result.end).toStrictEqual({ kind: "stopped" });
  expect(result.cases).toHaveLength(1);
  expect(model.calls).toStrictEqual(["a", "a", "a"]);
  expect(result.spent).toBeCloseTo((3 * (100_000 * 0.1 + 100 * 0.5)) / 1_000_000, 12);
});

it("makes 0 calls and spends nothing on a rerun over the same cache", async () => {
  await runEval(spec(), job(stub({ a: 1 }).complete));
  const again = stub({});
  const result = await runEval(spec(), job(again.complete));

  expect(again.calls).toHaveLength(0);
  expect(result).toMatchObject({ cached: 9, calls: 0, end: { kind: "done" }, spent: 0 });
  expect(result.cases[0]).toMatchObject({ fails: 1, pass: true });
});

it("re-grades cached text when the grader changes", async () => {
  await runEval(spec(), job(stub({}).complete));
  const strict = spec({ cases: [{ id: "one-bad", input: "a", pass: () => false, source: "s" }] });
  const again = stub({});
  const result = await runEval(strict, job(again.complete));

  expect(again.calls).toHaveLength(0);
  expect(result.cases).toStrictEqual([{ control: false, fails: 3, id: "one-bad", pass: false, samples: 3 }]);
});

it("ends failed on one failed sample, keeps the others and calls no later case", async () => {
  const calls: string[] = [];
  let n = 0;

  function complete(input: string) {
    calls.push(input);
    n += 1;

    if (n === 2) return Promise.reject(new Error("API error 401: bad key"));

    return Promise.resolve({ inputTokens: 1000, outputTokens: 100, text: "good" });
  }

  const result = await runEval(spec(), job(complete));

  expect(result.end).toStrictEqual({ kind: "failed", message: "API error 401: bad key" });
  expect(result.cases).toStrictEqual([]);
  expect(calls).toStrictEqual(["a", "a", "a"]);
  expect(result).toMatchObject({ cached: 0, calls: 3 });
  expect(result.spent).toBeCloseTo(2 * PER_CALL, 12);

  const rerun = stub({});
  const next = await runEval(spec(), job(rerun.complete));

  expect(next.cached).toBe(2);
  expect(rerun.calls.filter((one) => one === "a")).toHaveLength(1);
});

it("stops on the session bound where the API bound would still run", async () => {
  const bound = (4 + FRAMING_TOKENS) * 0.1 + 256 * 0.5;
  const cap = ((3 * (bound + 1500 * 0.1)) / 1_000_000) * 1.05;
  const api = await runEval(spec(), job(stub({}, 10).complete, cap, "api"));
  const session = await runEval(spec(), job(stub({}, 10).complete, cap, "session"));

  expect(api.end).toStrictEqual({ kind: "done" });
  expect(session.end).toStrictEqual({ kind: "stopped" });
  expect(session.cases).toHaveLength(1);
});

it("spends a reply past maxTokens in full", async () => {
  const result = await runEval(spec({ cases: [{ id: "a", input: "a", pass, source: "s" }] }), job(long, 1, "session"));

  expect(result.spent).toBeCloseTo((3 * (1000 * 0.1 + 5000 * 0.5)) / 1_000_000, 12);
});

it("keeps API keys as they were and gives session keys their own", () => {
  const one = { id: "a", input: "a", pass, source: "s" };
  const parts = { input: "a", maxTokens: 256, model: "claude-haiku-5-5", sample: 0, system: "sys" };

  expect(sampleKey(spec(), one, { sample: 0, via: "api" })).toBe(cacheKey(parts));
  expect(sampleKey(spec(), one, { sample: 0, via: "session" })).not.toBe(cacheKey(parts));
  const first = sampleKey(spec(), one, { sample: 0, via: "session" });

  expect(sampleKey(spec(), one, { sample: 1, via: "session" })).not.toBe(first);
});
