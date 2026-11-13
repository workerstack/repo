import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { dollars, estimate, type Via } from "../cli/eval/estimate.ts";
import { loadEval } from "../cli/eval/load.ts";
import { DEFAULT_MAX_TOKENS, FRAMING_TOKENS, SESSION_FRAMING_TOKENS } from "../cli/eval/price.constants.ts";
import type { ClaudeCall } from "../cli/eval/session-client.ts";
import { sessionReply, useEvalRun } from "../cli/scripts/__fixtures__/eval-run.ts";
import type { EvalDeps } from "../cli/scripts/eval.ts";
import { cases as rulesCases } from "./rules-compliance/cases.ts";
import { cases as routingCases } from "./skill-routing/cases.ts";

const ROOT = join(import.meta.dirname, "..");
const CONTROL_SUFFIX = /-control$/;
const VERDICT = /^(?:pass|fail) \S+/;
const SAMPLES = 3;
const VIAS: Via[] = ["api", "session"];
const { run } = useEvalRun();

type Case = { id: string; input: string; expect: string };

type Eval = { cases: readonly Case[]; name: string };

/** What a stub model saw: how many calls, the flags that pick it and the deps that answer them. */
type Stub = { calls: () => number; deps: EvalDeps; flags: string[] };

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

/** The usage a call of `system` and `content` bills at `scale` times its bound, with `framing` extra input tokens. */
function usageOf(call: { system: string; content: string; maxTokens: number }, framing: number, scale: number) {
  const bytes = Buffer.byteLength(call.system, "utf8") + Buffer.byteLength(call.content, "utf8") + framing;

  return { input_tokens: scale * bytes, output_tokens: scale * call.maxTokens };
}

/** An offline API that answers each case from `byInput`, bills `scale` times each call's bound and counts them. */
function stubApi(byInput: Map<string, string>, scale: number): Stub {
  let calls = 0;

  function fetchFn(_url: string, init: RequestInit): Promise<Response> {
    calls += 1;
    const sent = sentSchema.parse(JSON.parse(z.string().parse(init.body)));
    const [{ content }] = sent.messages;
    const usage = usageOf({ content, maxTokens: sent.max_tokens, system: sent.system }, FRAMING_TOKENS, scale);
    const text = byInput.get(content) ?? "unknown input";

    return Promise.resolve(new Response(JSON.stringify({ content: [{ text, type: "text" }], usage })));
  }

  return { calls: () => calls, deps: { fetchFn }, flags: ["--via", "api"] };
}

/** The same offline model behind `claude -p`: answers by what arrives on stdin and bills Claude Code's framing too. */
function stubSession(byInput: Map<string, string>, scale: number): Stub {
  let calls = 0;

  function runClaude(call: ClaudeCall): Promise<{ code: number; stdout: string }> {
    calls += 1;
    const framing = FRAMING_TOKENS + SESSION_FRAMING_TOKENS;
    const usage = usageOf({ content: call.stdin, maxTokens: DEFAULT_MAX_TOKENS, system: call.system }, framing, scale);

    return Promise.resolve(sessionReply(byInput.get(call.stdin) ?? "unknown input", usage));
  }

  return { calls: () => calls, deps: { runClaude }, flags: ["--via", "session"] };
}

/** Every eval through every via. */
const MATRIX = EVALS.flatMap((one) => VIAS.map((via) => ({ ...one, via })));

/** The stub model for `via`. */
function stubFor(via: Via, byInput: Map<string, string>, scale = 1): Stub {
  return via === "api" ? stubApi(byInput, scale) : stubSession(byInput, scale);
}

/** The worst-case cost of eval `name` through `via` with nothing cached. */
async function bound(name: string, via: Via): Promise<number> {
  const loaded = await loadEval(ROOT, name);

  if (!loaded.ok) throw new Error(loaded.message);
  const found = estimate(name, loaded.spec, { cap: 1, via });

  if (!found.ok) throw new Error(found.message);

  return found.cost;
}

/** The `pass <id>` or `fail <id>` of each report line, without a `(control)` mark. */
function verdicts(out: string): string[] {
  return out.split("\n").flatMap((line) => VERDICT.exec(line)?.[0] ?? []);
}

describe.each(MATRIX)("$name offline via $via, by the cap", (one) => {
  const { cases, name, via } = one;

  it("refuses a cap below the estimate before any call", async () => {
    const stub = stubFor(via, rightAnswers(cases));
    const got = await run([name, ...stub.flags, "--max-cost", "0.0001"], { ...stub.deps, root: ROOT });

    expect(got).toMatchObject({ code: 1, keyReads: 0, out: "" });
    expect(got.err).toMatch(new RegExp(`^eval ${name}: at most \\$[\\d.]+ is over the cap \\$0\\.0001`, "v"));
    expect(stub.calls()).toBe(0);
  });

  it("stops mid-run, exit 1, at a cap of the estimate when real spend runs twice the estimate", async () => {
    const cap = await bound(name, via);
    const stub = stubFor(via, rightAnswers(cases), 2);
    const got = await run([name, ...stub.flags, "--max-cost", String(cap)], { ...stub.deps, root: ROOT });
    const ran = verdicts(got.out).length;

    expect(got.code).toBe(1);
    expect(got.err).toContain(`eval ${name}: stopped at the cap ${dollars(cap)} after ${ran} of ${cases.length} cases`);
    expect(ran).toBeGreaterThan(0);
    expect(ran).toBeLessThan(cases.length);
  });
});

describe.each(MATRIX)("$name offline via $via, by the answers", (one) => {
  const { cases, name, via } = one;

  it("passes every case on right answers, then a rerun spends $0.0000 all from the cache", async () => {
    const stub = stubFor(via, rightAnswers(cases));
    const calls = cases.length * SAMPLES;
    const first = await run([name, ...stub.flags], { ...stub.deps, root: ROOT });

    expect(first).toMatchObject({ code: 0, err: "" });
    expect(verdicts(first.out)).toStrictEqual(cases.map((each) => `pass ${each.id}`));
    expect(stub.calls()).toBe(calls);

    const again = await run([name, ...stub.flags], { ...stub.deps, root: ROOT });

    expect(again.out).toContain(`spent $0.0000 of $1.00, ${calls} of ${calls} calls cached\n`);
    expect(stub.calls()).toBe(calls);
  });

  it("fails every case on its pair's answers", async () => {
    const stub = stubFor(via, pairAnswers(cases));
    const got = await run([name, ...stub.flags], { ...stub.deps, root: ROOT });

    expect(verdicts(got.out)).toStrictEqual(cases.map((each) => `fail ${each.id}`));
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
