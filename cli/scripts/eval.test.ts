import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { dollars, estimate } from "../eval/estimate.ts";
import { loadEval } from "../eval/load.ts";
import { answer, EVAL_FIXTURES as ROOT, MESSAGE, useEvalRun } from "./__fixtures__/eval-run.ts";
import { main } from "./eval.ts";

const SUMMARY_LINE = /^summary (?<file>.+-20261113T101500123Z-[0-9a-f]{4}\.json)$/m;
const { run, state, summaries } = useEvalRun();

/** The parsed summary file a run's stdout names. */
function summaryOf(out: string): { end: { kind: string; message?: string }; cached: number; calls: number } {
  const file = SUMMARY_LINE.exec(out)?.groups?.file ?? "";

  // The summary is JSON this command wrote; the test reads back the fields it asserts.
  return JSON.parse(fs.readFileSync(file, "utf8")) /* written by writeSummary */ as ReturnType<typeof summaryOf>;
}

async function worst() {
  const loaded = await loadEval(ROOT, "sample");

  if (!loaded.ok) throw new Error(loaded.message);
  const found = estimate("sample", loaded.spec, { cap: 1 });

  if (!found.ok) throw new Error(found.message);

  return found;
}

it("--dry-run prints the estimate, never reads the key and never calls the API", async () => {
  const found = await worst();
  const got = await run(["sample", "--dry-run"]);

  expect(got).toMatchObject({ code: 0, err: "", fetches: 0, keyReads: 0, out: `${found.text}\n` });
  expect(found.text).toBe(
    "eval sample: 2 cases x 3 samples = 6 calls on claude-haiku-5-5, at most $0.0008 (cap $1.00)",
  );
});

it("refuses over the cap before any call or key read", async () => {
  const got = await run(["sample", "--max-cost", "0.0001"]);

  expect(got).toMatchObject({ code: 1, fetches: 0, keyReads: 0, out: "" });
  expect(got.err).toBe("eval sample: at most $0.0008 is over the cap $0.0001; raise it with --max-cost <usd>\n");
});

it("refuses over the cap on a dry run too", async () => {
  const got = await run(["sample", "--dry-run", "--max-cost", "0.0001"]);

  expect(got).toMatchObject({ code: 1, fetches: 0 });
});

it("asks for the key on a real run and calls nothing", async () => {
  const got = await run(["sample"], { env: {} });

  expect(got).toMatchObject({ code: 1, fetches: 0 });
  expect(got.err).toBe("eval: set ANTHROPIC_API_KEY to run; --dry-run needs none\n");
});

it("runs the cases and prints pass or fail per case, controls marked, then the spend", async () => {
  const got = await run(["sample"]);

  expect(got).toMatchObject({ code: 0, err: "", fetches: 6 });
  const found = await worst();

  const file = SUMMARY_LINE.exec(got.out)?.groups?.file ?? "";

  expect(got.out).toBe(`${found.text}\npass yes\nfail no (control)\nspent $0.0007 of $1.00\nsummary ${file}\n`);
  expect(path.isAbsolute(file)).toBe(true);
  expect(summaryOf(got.out)).toMatchObject({ cached: 0, calls: 6, end: { kind: "done" } });
});

it("answers a rerun of unchanged text from the cache for $0", async () => {
  await run(["sample"]);
  const again = await run(["sample"]);
  const head = "eval sample: 2 cases x 3 samples = 6 calls on claude-haiku-5-5, 6 cached, at most $0.0000 (cap $1.00)";

  expect(again).toMatchObject({ code: 0, err: "", fetches: 0 });
  expect(again.out).toContain(`${head}\npass yes\nfail no (control)\nspent $0.0000 of $1.00, 6 of 6 calls cached\n`);
  expect(summaryOf(again.out)).toMatchObject({ cached: 6, calls: 0, end: { kind: "done" } });
  expect(summaries()).toHaveLength(2);
});

it("counts cached calls on a dry run and writes no summary", async () => {
  await run(["sample"]);
  const dry = await run(["sample", "--dry-run"]);

  expect(dry).toMatchObject({ code: 0, fetches: 0, keyReads: 0 });
  expect(dry.out).toContain(", 6 cached, at most $0.0000");
  expect(summaries()).toHaveLength(1);
});

it("stops before the next case once real spend leaves no room for its bound", async () => {
  const found = await worst();
  let billed = 0;

  /** Bills far more input tokens than the bytes bound allows, as a wrong estimate would. */
  function overBilled(): Promise<Response> {
    billed += 1;
    const usage = { input_tokens: 100_000, output_tokens: 200 };

    return Promise.resolve(new Response(JSON.stringify({ ...MESSAGE, usage })));
  }

  const got = await run(["sample", "--max-cost", String(found.cost)], { fetchFn: overBilled });

  const stop = [
    `eval sample: stopped at the cap ${dollars(found.cost)} after 1 of 2 cases`,
    "raise it with --max-cost <usd>\n",
  ].join("; ");

  expect(got).toMatchObject({ code: 1, err: stop });
  expect(billed).toBe(3);
  expect(got.out).toMatch(/\npass yes\nspent \$0\.0303 of \$0\.\d{4}\nsummary \S/);
  expect(summaryOf(got.out).end).toStrictEqual({ kind: "stopped" });
});

it("reads the main checkout's cache by default on a dry run", async () => {
  const out: string[] = [];
  const code = await main(["sample", "--dry-run"], { root: ROOT, stdout: (s) => out.push(s) });

  expect(code).toBe(0);
  expect(out.join("")).toContain("eval sample: 2 cases x 3 samples");
});

it("stamps the summary with the real clock by default", async () => {
  const out: string[] = [];
  const deps = { env: { ANTHROPIC_API_KEY: "key" }, fetchFn: answer, root: ROOT, state: state() };
  const code = await main(["sample"], { ...deps, stdout: (s) => out.push(s) });

  expect(code).toBe(0);
  expect(summaries()[0]).toMatch(
    new RegExp(`^sample-${new Date().getUTCFullYear()}\\d{4}T\\d{9}Z-[0-9a-f]{4}\\.json$`, "v"),
  );
});

it("accepts --max-cost before the name", async () => {
  const got = await run(["--max-cost", "5", "sample", "--dry-run"]);

  expect(got.out).toContain("(cap $5.00)");
});

it("names a missing eval", async () => {
  const got = await run(["nope"]);

  expect(got).toMatchObject({ code: 1, err: "eval: no evals/nope/eval.ts\n", out: "" });
});

it("names the model the estimate does not know", async () => {
  const got = await run(["unknown-model"]);

  expect(got).toMatchObject({ code: 1, fetches: 0, out: "" });
  expect(got.err).toBe(
    "eval unknown-model: unknown model gpt-nope; known: claude-haiku-5-5, claude-opus-5-5, claude-sonnet-5-5\n",
  );
});

it.each([["0"], ["-1"], ["abc"], [""]])("refuses --max-cost %j", async (value) => {
  const got = await run(["sample", "--max-cost", value]);

  expect(got).toMatchObject({ code: 4, fetches: 0, out: "" });
  expect(got.err).toBe(`eval: --max-cost needs a positive number of dollars, got ${JSON.stringify(value)}\n`);
});

it("refuses --max-cost with no value", async () => {
  const got = await run(["sample", "--max-cost"]);

  expect(got).toMatchObject({ code: 4 });
  expect(got.err).toContain("--max-cost needs a positive number");
});

it("prints usage with no name, two names or an unknown flag", async () => {
  const runs = await Promise.all([[], ["a", "b"], ["sample", "--wat"]].map((argv) => run(argv)));

  for (const got of runs) {
    expect(got).toMatchObject({ code: 4, out: "" });
    expect(got.err).toBe("usage: bun repo eval <name> [--dry-run] [--max-cost <usd>] [--changed <base>]\n");
  }
});

function unauthorized(): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }));
}

function offline(): Promise<Response> {
  return Promise.reject(new Error("offline"));
}

it("prints a failed fetch's message", async () => {
  const got = await run(["sample"], { fetchFn: offline });

  expect(got.err).toBe("offline\n");
});

it("exits 1 with the API's message when a call fails", async () => {
  const got = await run(["sample"], { fetchFn: unauthorized });

  expect(got).toMatchObject({ code: 1 });
  expect(got.err).toBe("eval: API error 401: bad key\n");
  expect(got.out).toMatch(/\nspent \$0\.0000 of \$1\.00\nsummary \S/);
  expect(summaryOf(got.out).end).toStrictEqual({ kind: "failed", message: "eval: API error 401: bad key" });
});
