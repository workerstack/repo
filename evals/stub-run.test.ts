import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { dollars, estimate } from "../cli/eval/estimate.ts";
import { loadEval } from "../cli/eval/load.ts";
import { FRAMING_TOKENS } from "../cli/eval/price.constants.ts";
import { useEvalRun } from "../cli/scripts/__fixtures__/eval-run.ts";
import { cases as rulesCases } from "./rules-compliance/cases.ts";
import { cases as routingCases } from "./skill-routing/cases.ts";

const ROOT = join(import.meta.dirname, "..");
const CONTROL_SUFFIX = /-control$/;
const VERDICT = /^(?:pass|fail) \S+/;
const SAMPLES = 3;
const { run } = useEvalRun();

type Case = { id: string; input: string; expect: string };

type Eval = { cases: readonly Case[]; name: string };

/** What a stub API saw: how many calls, and the fetch that answered them. */
type StubApi = { calls: () => number; fetchFn: (url: string, init: RequestInit) => Promise<Response> };

const EVALS: Eval[] = [
  { cases: routingCases, name: "skill-routing" },
  { cases: rulesCases, name: "rules-compliance" },
];

/** The fields of a request createClient sent that the stub answers by. */
const sentSchema = z.object({
  max_tokens: z.number(),
  messages: z.tuple([z.object({ content: z.string() })]),
  system: z.string(),
});

/** Each input of `cases` mapped to its own expected answer. */
function rightAnswers(cases: readonly Case[]): Map<string, string> {
  return new Map(cases.map((one) => [one.input, one.expect]));
}

/** The id of the case paired with `id`: a control's routed case, or a routed case's control. */
function pairOf(id: string): string {
  return CONTROL_SUFFIX.test(id) ? id.replace(CONTROL_SUFFIX, "") : `${id}-control`;
}

/** Each input of `cases` mapped to its paired case's expected answer. */
function pairAnswers(cases: readonly Case[]): Map<string, string> {
  const byId = new Map(cases.map((one) => [one.id, one.expect]));

  return new Map(cases.map((one) => [one.input, byId.get(pairOf(one.id)) ?? ""]));
}

/**
 * An offline API that answers each case from `byInput`, counts its calls, and bills `scale` times the input and
 * output bound of each call: 1 for an honest bill, 2 for one that spends twice as fast as estimated.
 */
function stubApi(byInput: Map<string, string>, scale = 1): StubApi {
  let calls = 0;

  function fetchFn(_url: string, init: RequestInit): Promise<Response> {
    calls += 1;
    const sent = sentSchema.parse(JSON.parse(z.string().parse(init.body)));
    const [{ content }] = sent.messages;
    const bytes = Buffer.byteLength(sent.system, "utf8") + Buffer.byteLength(content, "utf8") + FRAMING_TOKENS;
    const usage = { input_tokens: scale * bytes, output_tokens: scale * sent.max_tokens };
    const text = byInput.get(content) ?? "unknown input";

    return Promise.resolve(new Response(JSON.stringify({ content: [{ text, type: "text" }], usage })));
  }

  return { calls: () => calls, fetchFn };
}

/** The worst-case cost of eval `name` with nothing cached. */
async function bound(name: string): Promise<number> {
  const loaded = await loadEval(ROOT, name);

  if (!loaded.ok) throw new Error(loaded.message);
  const found = estimate(name, loaded.spec, { cap: 1 });

  if (!found.ok) throw new Error(found.message);

  return found.cost;
}

/** The `pass <id>` or `fail <id>` of each report line, without a `(control)` mark. */
function verdicts(out: string): string[] {
  return out.split("\n").flatMap((line) => VERDICT.exec(line)?.[0] ?? []);
}

describe.each(EVALS)("$name offline, by the cap", ({ cases, name }) => {
  it("refuses a cap below the estimate before any call", async () => {
    const api = stubApi(rightAnswers(cases));
    const got = await run([name, "--max-cost", "0.0001"], { fetchFn: api.fetchFn, root: ROOT });

    expect(got).toMatchObject({ code: 1, keyReads: 0, out: "" });
    expect(got.err).toMatch(new RegExp(`^eval ${name}: at most \\$[\\d.]+ is over the cap \\$0\\.0001`, "v"));
    expect(api.calls()).toBe(0);
  });

  it("stops mid-run, exit 1, at a cap of the estimate when real spend runs twice the estimate", async () => {
    const cap = await bound(name);
    const api = stubApi(rightAnswers(cases), 2);
    const got = await run([name, "--max-cost", String(cap)], { fetchFn: api.fetchFn, root: ROOT });
    const ran = verdicts(got.out).length;

    expect(got.code).toBe(1);
    expect(got.err).toContain(`eval ${name}: stopped at the cap ${dollars(cap)} after ${ran} of ${cases.length} cases`);
    expect(ran).toBeGreaterThan(0);
    expect(ran).toBeLessThan(cases.length);
  });
});

describe.each(EVALS)("$name offline, by the answers", ({ cases, name }) => {
  it("passes every case on right answers, then a rerun spends $0.0000 all from the cache", async () => {
    const api = stubApi(rightAnswers(cases));
    const calls = cases.length * SAMPLES;
    const first = await run([name], { fetchFn: api.fetchFn, root: ROOT });

    expect(first).toMatchObject({ code: 0, err: "" });
    expect(verdicts(first.out)).toStrictEqual(cases.map((one) => `pass ${one.id}`));
    expect(api.calls()).toBe(calls);

    const again = await run([name], { fetchFn: api.fetchFn, root: ROOT });

    expect(again.out).toContain(`spent $0.0000 of $1.00, ${calls} of ${calls} calls cached\n`);
    expect(api.calls()).toBe(calls);
  });

  it("fails every case on its pair's answers", async () => {
    const got = await run([name], { fetchFn: stubApi(pairAnswers(cases)).fetchFn, root: ROOT });

    expect(verdicts(got.out)).toStrictEqual(cases.map((one) => `fail ${one.id}`));
  });
});

const CHANGES = [
  { file: "agents/skills/su/SKILL.md", picked: "skill-routing" },
  { file: "agents/rules/overview.md", picked: "rules-compliance" },
  { file: "evals/skill-routing/cases.ts", picked: "skill-routing" },
];

/** Every change crossed with every eval: whether that eval must run in full for it. */
const SELECTIONS = CHANGES.flatMap(({ file, picked }) =>
  EVALS.map(({ cases, name }) => ({ file, isPicked: name === picked, name, total: cases.length })),
);

it.each(SELECTIONS)("a change to $file runs $name in full: $isPicked", async ({ file, isPicked, name, total }) => {
  const got = await run([name, "--changed", "main", "--dry-run"], { changedSince: () => [file], root: ROOT });

  const head = isPicked
    ? `eval ${name}: ${file} changed since main\neval ${name}: ${total} cases x ${SAMPLES} samples`
    : `eval ${name}: nothing it reads changed since main\n`;

  expect(got.code).toBe(0);
  expect(got.out.slice(0, head.length)).toBe(head);
});
