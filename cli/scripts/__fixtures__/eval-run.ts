import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach } from "vitest";

import { main, type EvalDeps } from "../eval.ts";

/** The eval fixtures' root, holding `evals/sample` and the broken specs. */
export const EVAL_FIXTURES: string = path.join(import.meta.dirname, "..", "..", "eval", "__fixtures__");
/** One API reply: the text `yes` with fixed usage. */
export const MESSAGE = { content: [{ text: "yes", type: "text" }], usage: { input_tokens: 100, output_tokens: 200 } };
const NOW = new Date("2026-11-13T10:15:00.123Z");

/** The API answering `yes` with fixed usage. */
export function answer(): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(MESSAGE)));
}

/** What one `repo eval` run printed and exited with, and how often it read the key and called the API. */
export type EvalRun = { code: number; err: string; out: string; fetches: number; keyReads: number };

/**
 * Per test file: a temp state dir made before each test and removed after, and a runner of `repo eval argv` on the
 * fixtures, answering `yes` and counting key reads and fetch calls unless `deps` says otherwise.
 */
export function useEvalRun(): {
  run: (argv: string[], deps?: EvalDeps) => Promise<EvalRun>;
  state: () => string;
  summaries: () => string[];
} {
  let stateDir = "";

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-state-"));
  });

  afterEach(() => {
    fs.rmSync(stateDir, { force: true, recursive: true });
  });

  async function run(argv: string[], deps: EvalDeps = {}): Promise<EvalRun> {
    const out: string[] = [];
    const err: string[] = [];
    const counts = { fetches: 0, keyReads: 0 };

    function fetchFn(): Promise<Response> {
      counts.fetches += 1;

      return answer();
    }

    const code = await main(argv, {
      env: {
        get ANTHROPIC_API_KEY() {
          counts.keyReads += 1;

          return "key";
        },
      },
      fetchFn,
      now: () => NOW,
      root: EVAL_FIXTURES,
      state: stateDir,
      stderr: (s) => err.push(s),
      stdout: (s) => out.push(s),
      ...deps,
    });

    return { code, err: err.join(""), out: out.join(""), ...counts };
  }

  /** The summary files the runs so far left in the state dir. */
  function summaries(): string[] {
    const runs = path.join(stateDir, "runs");

    return fs.existsSync(runs) ? fs.readdirSync(runs) : [];
  }

  return { run, state: () => stateDir, summaries };
}
