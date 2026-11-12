import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { choiceBody, counted, ENDPOINT_QUESTIONS, homeAtCap, jsonResponse, plantDir } from "./__fixtures__/jev-kit.ts";
import { createJevRunner } from "./create-jev-runner.ts";
import { runJev } from "./jev.ts";

const KEY = "ts_live_test_key";
const STATE = "short";

/** Each run that must stop before any fetch, with the refusal it prints. */
function blockedRuns() {
  const fileKey = plantDir("jev-file-");
  const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`q${i}`, { instructions: "x", type: "noul" }]));
  const withKey = { env: { TYPESAFE_API_KEY: KEY }, questionsText: ENDPOINT_QUESTIONS, stateText: STATE };

  return [
    { ...withKey, env: {}, home: plantDir("jev-nokey-"), label: "missing key", text: /missing TYPESAFE_API_KEY/ },
    {
      ...withKey,
      home: fileKey,
      label: "nine questions",
      questionsText: JSON.stringify(nine),
      text: /questions exceed 8/,
    },
    { ...withKey, home: fileKey, label: "huge state", stateText: "x".repeat(64_001), text: /state exceeds 64000/ },
    {
      ...withKey,
      home: homeAtCap("jev-block-", { input_tokens: 0, requests: 40 }),
      label: "request cap",
      text: /daily request cap 40/,
    },
    {
      ...withKey,
      home: homeAtCap("jev-tokens-", { input_tokens: 1_000_000, requests: 0 }),
      label: "token cap",
      text: /daily input token cap 1000000/,
    },
  ];
}

it("runJev does not fetch when the key, question count, state, or ledger already blocks", async () => {
  const outcomes = await Promise.all(
    blockedRuns().map(async ({ label, text, ...row }) => {
      const { calls, fetchImpl } = counted(() => jsonResponse(200, choiceBody()));

      return { calls, label, result: await createJevRunner()({ ...row, fetchImpl }), text };
    }),
  );

  for (const { calls, label, result, text } of outcomes) {
    expect(result.code, label).toBe(2);
    expect(result.text, label).toMatch(text);
    expect(calls.length, label).toBe(0);
  }
});

it("main reports key availability without a request or a setup error", async () => {
  const missing = await runJev(["--available"], { env: {}, home: plantDir("jev-avail-no-") });
  expect(missing).toStrictEqual({ code: 0, text: "no\n" });
  const home = plantDir("jev-avail-yes-");
  fs.mkdirSync(path.join(home, ".workerstack"), { recursive: true });
  fs.writeFileSync(path.join(home, ".workerstack", "jev.json"), JSON.stringify({ apiKey: KEY }));
  const present = await runJev(["--available"], { env: {}, home });
  expect(present).toStrictEqual({ code: 0, text: "yes\n" });
  expect(present.text).not.toContain(KEY);
});

it("main exits 2 with usage and no key text when args are missing", async () => {
  const result = await runJev([], { env: { TYPESAFE_API_KEY: KEY } });
  expect(result.code).toBe(2);
  expect(result.text).toMatch(/usage: bun repo jev --available \| --state FILE --questions FILE/);
  expect(result.text).not.toContain(KEY);
});
