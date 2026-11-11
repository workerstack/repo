import fs from "node:fs";

import { expect, it } from "vitest";

import { createJevRunner } from "./create-jev-runner.ts";
import { choiceBody, counted, ENDPOINT_QUESTIONS, jsonResponse, plantDir, sleeper } from "./fixtures/jev-kit.ts";
import { estimateTokens, jevUsagePath } from "./jev-key.ts";

const env = { TYPESAFE_API_KEY: "ts_live_test_key" };
const SECRET_STATE = "SECRET_STATE_BODY";

function sleepThrows(): Promise<void> {
  return Promise.reject(new Error("slept"));
}

it("runJev retries one 429 inside two seconds and counts both requests", async () => {
  const home = plantDir("jev-429-");
  const state = "excerpt";
  const { waits, sleep } = sleeper();
  const { calls, fetchImpl } = counted((n) =>
    n === 1 ? jsonResponse(429, { error: "slow" }, { "retry-after": "1" }) : jsonResponse(200, choiceBody()),
  );
  const result = await createJevRunner()({
    env,
    fetchImpl,
    home,
    questionsText: ENDPOINT_QUESTIONS,
    sleep,
    stateText: state,
  });
  expect(result.code).toBe(0);
  expect(waits).toStrictEqual([1000]);
  expect(calls).toHaveLength(2);
  const ledger = JSON.parse(fs.readFileSync(jevUsagePath(home), "utf8")) /* the runner writes this shape */ as {
    requests: number;
    input_tokens: number;
  };
  expect(ledger.requests).toBe(2);
  expect(ledger.input_tokens).toBe(estimateTokens(state, ENDPOINT_QUESTIONS) + 120);
});

it("runJev does not retry when Retry-After is over two seconds", async () => {
  const slow = counted(() => jsonResponse(429, { echo: SECRET_STATE }, { "retry-after": "5" }));
  const slowResult = await createJevRunner()({
    env,
    fetchImpl: slow.fetchImpl,
    home: plantDir("jev-noretry-"),
    questionsText: ENDPOINT_QUESTIONS,
    sleep: sleepThrows,
    stateText: SECRET_STATE,
  });
  expect(slowResult.code).toBe(2);
  expect(slowResult.text).toBe("jev request failed\n");
  expect(slowResult.text).not.toContain(SECRET_STATE);
  expect(slow.calls).toHaveLength(1);
});

it("runJev does not retry when the status is 401", async () => {
  const denied = counted(() => jsonResponse(401, { echo: SECRET_STATE }));
  const authResult = await createJevRunner()({
    env,
    fetchImpl: denied.fetchImpl,
    home: plantDir("jev-401-"),
    questionsText: ENDPOINT_QUESTIONS,
    stateText: SECRET_STATE,
  });
  expect(authResult.code).toBe(2);
  expect(authResult.text).not.toContain(SECRET_STATE);
  expect(denied.calls).toHaveLength(1);
});
