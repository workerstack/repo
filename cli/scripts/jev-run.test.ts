import fs from "node:fs";

import { expect, it } from "vitest";

import { createJevRunner } from "./create-jev-runner.ts";
import { counted, choiceBody, ENDPOINT_QUESTIONS, jsonResponse, plantDir } from "./fixtures/jev-kit.ts";
import { estimateTokens, jevUsagePath } from "./jev-key.ts";
import { ENDPOINT, MODEL } from "./jev.constants.ts";

const KEY = "ts_live_test_key";

type Sent = { model?: string; state?: unknown; questions: { endpoint: { type: string } } };

/** The ledger as the runner wrote it. */
function ledgerOf(home: string): { requests: number; input_tokens: number } {
  return JSON.parse(fs.readFileSync(jevUsagePath(home), "utf8")) /* the runner writes this shape */ as {
    requests: number;
    input_tokens: number;
  };
}

/** The body of the `n`th request, as the runner sent it. */
function sentBody(calls: { init: { body: string } }[], n = 0): Sent {
  return JSON.parse(calls[n]?.init.body ?? "") /* the runner posts this shape */ as Sent;
}

it("runJev posts one pinned choice and stores the real input token count", async () => {
  const home = plantDir("jev-ok-");
  const state = "docs say POST /v1/systemone";
  const { calls, fetchImpl } = counted(() => jsonResponse(200, choiceBody()));
  const run = createJevRunner();
  const opts = { env: { TYPESAFE_API_KEY: KEY }, fetchImpl, home, questionsText: ENDPOINT_QUESTIONS, stateText: state };
  const result = await run(opts);
  expect(result.code).toBe(0);
  expect(result.text).toContain(`${MODEL}. input_tokens=120`);
  expect(result.text).toContain("- endpoint choice=typesafe confidence=0.91");
  expect(result.text).not.toContain(KEY);
  expect(calls).toHaveLength(1);
  const [hit] = calls;
  expect(hit?.url).toBe(ENDPOINT);
  expect(hit?.init.headers.Authorization).toBe(`Bearer ${KEY}`);
  const sent = sentBody(calls);
  expect(sent.model).toBe(MODEL);
  expect(sent.state).toBe(state);
  expect(sent.questions.endpoint.type).toBe("choice");
  expect(JSON.stringify(sent)).not.toContain(KEY);
  const ledger = ledgerOf(home);
  expect(ledger.requests).toBe(1);
  expect(ledger.input_tokens).toBe(120);
  expect(ledger.input_tokens).not.toBe(estimateTokens(state, ENDPOINT_QUESTIONS));
  const again = await run(opts);
  expect(again.code).toBe(2);
  expect(again.text).toBe("process request cap 1\n");
  expect(calls).toHaveLength(1);
});

it("runJev prints a low-confidence choice and does not call again", async () => {
  const { calls, fetchImpl } = counted(() => jsonResponse(200, choiceBody(0.1)));
  const result = await createJevRunner()({
    env: { TYPESAFE_API_KEY: KEY },
    fetchImpl,
    home: plantDir("jev-low-"),
    questionsText: ENDPOINT_QUESTIONS,
    stateText: "page text",
  });
  expect(result.code).toBe(0);
  expect(result.text).toContain("confidence=0.1");
  expect(calls).toHaveLength(1);
});

it("runJev sends a JSON state object", async () => {
  const { calls, fetchImpl } = counted(() =>
    jsonResponse(200, { answers: { keep: { noul: 0.2, type: "noul" } }, model: MODEL, usage: { input_tokens: 10 } }),
  );
  await createJevRunner()({
    env: { TYPESAFE_API_KEY: KEY },
    fetchImpl,
    home: plantDir("jev-json-"),
    questionsText: JSON.stringify({ keep: { instructions: "Does this promise zero retention?", type: "noul" } }),
    stateText: '{"page":"privacy"}\n',
  });
  expect(sentBody(calls).state).toStrictEqual({ page: "privacy" });
});
