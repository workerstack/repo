import path from "node:path";

import { expect, it } from "vitest";

import { estimate } from "../eval/estimate.ts";
import { loadEval } from "../eval/load.ts";
import { main, type EvalDeps } from "./eval.ts";

const ROOT = path.join(import.meta.dirname, "..", "eval", "__fixtures__");
const MESSAGE = { content: [{ text: "yes", type: "text" }], usage: { input_tokens: 100, output_tokens: 200 } };

/** Runs `repo eval argv` against the fixtures; the key reads and the fetch calls are counted. */
async function run(argv: string[], deps: EvalDeps = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const state = { fetches: 0, keyReads: 0 };

  function fetchFn(): Promise<Response> {
    state.fetches += 1;

    return Promise.resolve(new Response(JSON.stringify(MESSAGE)));
  }

  const code = await main(argv, {
    env: {
      get ANTHROPIC_API_KEY() {
        state.keyReads += 1;

        return "key";
      },
    },
    fetchFn,
    root: ROOT,
    stderr: (s) => err.push(s),
    stdout: (s) => out.push(s),
    ...deps,
  });

  return { code, err: err.join(""), out: out.join(""), ...state };
}

async function worst() {
  const loaded = await loadEval(ROOT, "sample");

  if (!loaded.ok) throw new Error(loaded.message);
  const found = estimate("sample", loaded.spec, 1);

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

  expect(got.out).toBe(`${found.text}\npass yes\nfail no (control)\nspent $0.0007 of $1.00\n`);
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
    expect(got.err).toBe("usage: bun repo eval <name> [--dry-run] [--max-cost <usd>]\n");
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
});
