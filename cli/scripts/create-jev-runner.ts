/** The jev runner: checks the inputs, reserves the ledger, makes the one call a process may make, and retries once. */
import os from "node:os";

import { repoEnv } from "../repo-env.ts";
import { isRecord } from "./hook-input.ts";
import { estimateTokens, loadJevKey, retryWaitMs } from "./jev-key.ts";
import { beginAttempt, settleTokens } from "./jev-ledger.ts";
import { fail, formatAnswers, headerGet, parseState, postOnce, stopText } from "./jev-post.ts";
import {
  HTTP_OK_END,
  HTTP_OK_MIN,
  MAX_QUESTIONS,
  MAX_STATE_CHARS,
  MISSING_KEY,
  NOT_AN_OBJECT,
  REQUEST_FAILED,
  RETRY_STATUSES,
  USAGE,
} from "./jev.constants.ts";
import type { Attempt, JevCall, JevInput, JevResult, JevRun, JevRunOpts, PostResult, Posted } from "./jev.types.ts";

function sleepMs(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** The run's state and questions texts, checked: a string each, the state in size, 1 to 8 questions in an object. */
function readJevInput({ stateText, questionsText }: JevRunOpts): JevInput | { fail: JevResult } {
  if (typeof stateText !== "string" || typeof questionsText !== "string") return { fail: fail(USAGE) };
  if (stateText.length > MAX_STATE_CHARS) return { fail: fail("state exceeds 64000 characters\n") };
  let questions: unknown;
  try {
    questions = JSON.parse(questionsText);
  } catch {
    return { fail: fail(NOT_AN_OBJECT) };
  }
  if (!isRecord(questions)) return { fail: fail(NOT_AN_OBJECT) };
  const count = Object.keys(questions).length;
  if (count < 1) return { fail: fail("questions missing\n") };
  if (count > MAX_QUESTIONS) return { fail: fail("questions exceed 8\n") };
  return { questions, questionsText, stateText };
}

/** Reserves the ledger, spends the process's request, and posts; a cap, a busy lock or a throw fails it. */
async function attempt(call: JevCall): Promise<Attempt> {
  const nowMs = call.nowFn();
  const begun = beginAttempt(call.home, nowMs, call.estimate);
  if ("busy" in begun) return { fail: fail(stopText("lock")) };
  if ("stop" in begun) return { fail: fail(stopText(begun.stop)) };
  call.spend();
  let response: PostResult;
  try {
    response = await postOnce(call.fetchImpl, call.key, { questions: call.questions, state: call.state });
  } catch {
    return { fail: fail(REQUEST_FAILED) };
  }
  return { nowMs, response };
}

/** A rate-limited first answer with a short enough retry-after is asked once more, after the wait. */
async function retried(call: JevCall, first: Posted): Promise<Attempt> {
  if (!RETRY_STATUSES.includes(first.response.status)) return first;
  const wait = retryWaitMs(headerGet(first.response.headers, "retry-after"), first.nowMs);
  if (wait == null) return first;
  await call.sleep(wait);
  return attempt(call);
}

/** The summary of a 2xx object answer, after the ledger takes the real token count; never one holding the key. */
function finish(call: JevCall, { response, nowMs }: Posted): JevResult {
  const body = response.json;
  if (response.status < HTTP_OK_MIN || response.status >= HTTP_OK_END || !isRecord(body)) return fail(REQUEST_FAILED);

  const actual = Number(isRecord(body.usage) ? body.usage.input_tokens : body.usage);
  if (Number.isFinite(actual) && actual >= 0) settleTokens({ actual, estimate: call.estimate, home: call.home, nowMs });
  const text = formatAnswers(body);
  if (text.includes(call.key)) return fail(REQUEST_FAILED);
  return { code: 0, text };
}

async function callJev(call: JevCall): Promise<JevResult> {
  const first = await attempt(call);
  if ("fail" in first) return first.fail;
  const last = await retried(call, first);
  if ("fail" in last) return last.fail;
  return finish(call, last);
}

/** The home dir the run reads and writes under: the given one, or the user's when none or "" is given. */
function homeOf({ home = "" }: JevRunOpts): string {
  return home === "" ? os.homedir() : home;
}

/** A runner that makes at most one request per process: every later run fails with the process cap. */
export function createJevRunner(): JevRun {
  const budget = { spent: false };
  return function runOnce(opts: JevRunOpts = {}): Promise<JevResult> {
    if (budget.spent) return Promise.resolve(fail("process request cap 1\n"));
    const home = homeOf(opts);
    const env = opts.env ?? repoEnv.process;
    const input = readJevInput(opts);
    if ("fail" in input) return Promise.resolve(input.fail);
    const key = loadJevKey({ env, home });
    if (key === "") return Promise.resolve(fail(MISSING_KEY));
    const nowOpt = opts.now;
    return callJev({
      estimate: estimateTokens(input.stateText, input.questionsText),
      // The global fetch returns a Response, which carries every JevResponse field.
      fetchImpl: opts.fetchImpl ?? globalThis.fetch,
      home,
      key,
      nowFn: typeof nowOpt === "function" ? nowOpt : () => nowOpt ?? Date.now(),
      questions: input.questions,
      sleep: opts.sleep ?? sleepMs,
      spend: () => {
        budget.spent = true;
      },
      state: parseState(input.stateText),
    });
  };
}
