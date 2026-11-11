import fs from "node:fs";

import { afterEach, expect, it, vi } from "vitest";

import {
  DAY,
  QUESTIONS,
  answerBody,
  go,
  plantDir,
  plantLedger,
  readLedgerFile,
  reply,
  scripted,
} from "./fixtures/jev-kit.ts";
import { estimateTokens } from "./jev-key.ts";
import { MAX_INPUT_TOKENS_PER_DAY, MAX_REQUESTS_PER_DAY } from "./jev.constants.ts";

afterEach(() => vi.restoreAllMocks());

it("daily caps: counts a request and settles the real token count", async () => {
  const home = plantDir();
  const out = await go({ fetchImpl: scripted(reply(200, answerBody({ usage: { input_tokens: 77 } }))), home });
  expect(out.code).toBe(0);
  expect(readLedgerFile(home)).toStrictEqual({ day: DAY, input_tokens: 77, requests: 1 });
});

it("daily caps: keeps the estimate when the reply reports no usable token count", async () => {
  const home = plantDir();
  await go({ fetchImpl: scripted(reply(200, answerBody({ usage: { input_tokens: -3 } }))), home });
  expect(readLedgerFile(home).input_tokens).toBe(estimateTokens("page", QUESTIONS));
  const other = plantDir();
  await go({ fetchImpl: scripted(reply(200, answerBody({ usage: undefined }))), home: other });
  expect(readLedgerFile(other).input_tokens).toBe(estimateTokens("page", QUESTIONS));
});

it("daily caps: stops at the daily request cap without calling", async () => {
  const home = plantDir();
  plantLedger(home, { day: DAY, input_tokens: 0, requests: MAX_REQUESTS_PER_DAY });
  const fetchImpl = scripted(reply(200, answerBody()));
  expect(await go({ fetchImpl, home })).toStrictEqual({ code: 2, text: "daily request cap 40\n" });
  expect(fetchImpl.calls).toBe(0);
});

it("daily caps: allows the last request of the day", async () => {
  const home = plantDir();
  plantLedger(home, { day: DAY, input_tokens: 0, requests: MAX_REQUESTS_PER_DAY - 1 });
  const result = await go({ fetchImpl: scripted(reply(200, answerBody())), home });
  expect(result.code).toBe(0);
  expect(readLedgerFile(home).requests).toBe(MAX_REQUESTS_PER_DAY);
});

it("daily caps: stops when the token cap is spent or the estimate would pass it", async () => {
  const fetchImpl = scripted(reply(200, answerBody()));
  const spent = plantDir();
  plantLedger(spent, { day: DAY, input_tokens: MAX_INPUT_TOKENS_PER_DAY, requests: 1 });
  expect(await go({ fetchImpl, home: spent })).toStrictEqual({ code: 2, text: "daily input token cap 1000000\n" });
  const near = plantDir();
  plantLedger(near, { day: DAY, input_tokens: MAX_INPUT_TOKENS_PER_DAY - 1, requests: 1 });
  const result = await go({ fetchImpl, home: near });
  expect(result.text).toBe("daily input token cap 1000000\n");
  expect(fetchImpl.calls).toBe(0);
});

it.each([
  { day: "2026-10-08", input_tokens: 5, requests: 40 },
  "{broken",
  "[1]",
  { day: DAY, input_tokens: null, requests: "x" },
])("daily caps: starts a new day, or a damaged ledger %j, from zero", async (planted) => {
  const home = plantDir();
  plantLedger(home, planted);
  const out = await go({ fetchImpl: scripted(reply(200, answerBody({ usage: { input_tokens: 4 } }))), home });
  expect(out.code).toBe(0);
  expect(readLedgerFile(home)).toStrictEqual({ day: DAY, input_tokens: 4, requests: 1 });
});

it("daily caps: never lets the settled count go below zero", async () => {
  const home = plantDir();
  function fetchImpl() {
    plantLedger(home, { day: DAY, input_tokens: 0, requests: 1 });
    return Promise.resolve(reply(200, answerBody({ usage: { input_tokens: 1 } })));
  }
  await go({ fetchImpl, home });
  expect(readLedgerFile(home).input_tokens).toBe(0);
});

it("daily caps: keeps the ledger when the platform refuses chmod", async () => {
  const home = plantDir();
  vi.spyOn(fs, "chmodSync").mockImplementation(() => {
    throw new Error("EPERM");
  });
  const result = await go({ fetchImpl: scripted(reply(200, answerBody())), home });
  expect(result.code).toBe(0);
  expect(readLedgerFile(home).requests).toBe(1);
});
