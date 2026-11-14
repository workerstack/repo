import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach } from "vitest";

import { main, type EvalDeps } from "../eval.ts";
import { removeTree } from "../../remove-tree.ts";

/** The eval fixtures' root, holding `evals/sample` and the broken specs. */
export const EVAL_FIXTURES: string = path.join(import.meta.dirname, "..", "..", "eval", "__fixtures__");
/** One API reply: the text `yes` with fixed usage. */
export const MESSAGE = { content: [{ text: "yes", type: "text" }], usage: { input_tokens: 100, output_tokens: 200 } };
const USAGE = { input_tokens: 100, output_tokens: 200 };
const NOW = new Date("2026-11-13T10:15:00.123Z");

/** One `claude -p --output-format json` reply with the same fixed usage as `MESSAGE`. */
export function sessionReply(text: string, usage = USAGE): { code: number; stdout: string } {
  return { code: 0, stdout: JSON.stringify({ is_error: false, result: text, usage }) };
}

/** The session answering `yes` with fixed usage. */
export function sessionAnswer(): Promise<{ code: number; stdout: string }> {
  return Promise.resolve(sessionReply("yes"));
}

/** The API answering `yes` with fixed usage. */
export function answer(): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(MESSAGE)));
}

/** What one `repo eval` run printed and exited with, and how often it read the key, called the API or `claude`. */
export type EvalRun = { code: number; err: string; out: string; fetches: number; keyReads: number; claudeCalls: number };

/**
 * Per test file: a temp state dir made before each test and removed after, and a runner of `repo eval argv` on the
 * fixtures, answering `yes` on the session and the API, counting key reads, fetch and `claude` calls unless `deps` says otherwise.
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
    removeTree(stateDir);
  });

  async function run(argv: string[], deps: EvalDeps = {}): Promise<EvalRun> {
    const out: string[] = [];
    const err: string[] = [];
    const counts = { claudeCalls: 0, fetches: 0, keyReads: 0 };

    function fetchFn(): Promise<Response> {
      counts.fetches += 1;

      return answer();
    }

    function runClaude(): Promise<{ code: number; stdout: string }> {
      counts.claudeCalls += 1;

      return sessionAnswer();
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
      runClaude,
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
