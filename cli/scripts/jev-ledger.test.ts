import fs from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { MAX_INPUT_TOKENS_PER_DAY, MAX_REQUESTS_PER_DAY, estimateTokens } from "./jev.ts";
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

afterEach(() => vi.restoreAllMocks());

it("daily caps: counts a request and settles the real token count", async () => {
  const home = plantDir();
  const out = await go({ home, fetchImpl: scripted(reply(200, answerBody({ usage: { input_tokens: 77 } }))) });
  expect(out.code).toBe(0);
  expect(readLedgerFile(home)).toEqual({ day: DAY, requests: 1, input_tokens: 77 });
});

it("daily caps: keeps the estimate when the reply reports no usable token count", async () => {
  const home = plantDir();
  await go({ home, fetchImpl: scripted(reply(200, answerBody({ usage: { input_tokens: -3 } }))) });
  expect(readLedgerFile(home).input_tokens).toBe(estimateTokens("page", QUESTIONS));
  const other = plantDir();
  await go({ home: other, fetchImpl: scripted(reply(200, answerBody({ usage: undefined }))) });
  expect(readLedgerFile(other).input_tokens).toBe(estimateTokens("page", QUESTIONS));
});

it("daily caps: stops at the daily request cap without calling", async () => {
  const home = plantDir();
  plantLedger(home, { day: DAY, requests: MAX_REQUESTS_PER_DAY, input_tokens: 0 });
  const fetchImpl = scripted(reply(200, answerBody()));
  expect(await go({ home, fetchImpl })).toEqual({ code: 2, text: "daily request cap 40\n" });
  expect(fetchImpl.calls).toBe(0);
});

it("daily caps: allows the last request of the day", async () => {
  const home = plantDir();
  plantLedger(home, { day: DAY, requests: MAX_REQUESTS_PER_DAY - 1, input_tokens: 0 });
  expect((await go({ home, fetchImpl: scripted(reply(200, answerBody())) })).code).toBe(0);
  expect(readLedgerFile(home).requests).toBe(MAX_REQUESTS_PER_DAY);
});

it("daily caps: stops when the token cap is spent or the estimate would pass it", async () => {
  const fetchImpl = scripted(reply(200, answerBody()));
  const spent = plantDir();
  plantLedger(spent, { day: DAY, requests: 1, input_tokens: MAX_INPUT_TOKENS_PER_DAY });
  expect(await go({ home: spent, fetchImpl })).toEqual({ code: 2, text: "daily input token cap 1000000\n" });
  const near = plantDir();
  plantLedger(near, { day: DAY, requests: 1, input_tokens: MAX_INPUT_TOKENS_PER_DAY - 1 });
  expect((await go({ home: near, fetchImpl })).text).toBe("daily input token cap 1000000\n");
  expect(fetchImpl.calls).toBe(0);
});

it.each([
  { day: "2026-10-08", requests: 40, input_tokens: 5 },
  "{broken",
  "[1]",
  { day: DAY, requests: "x", input_tokens: null },
])("daily caps: starts a new day, or a damaged ledger %j, from zero", async (planted) => {
  const home = plantDir();
  plantLedger(home, planted);
  const out = await go({ home, fetchImpl: scripted(reply(200, answerBody({ usage: { input_tokens: 4 } }))) });
  expect(out.code).toBe(0);
  expect(readLedgerFile(home)).toEqual({ day: DAY, requests: 1, input_tokens: 4 });
});

it("daily caps: never lets the settled count go below zero", async () => {
  const home = plantDir();
  const fetchImpl = () => {
    plantLedger(home, { day: DAY, requests: 1, input_tokens: 0 });
    return Promise.resolve(reply(200, answerBody({ usage: { input_tokens: 1 } })));
  };
  await go({ home, fetchImpl });
  expect(readLedgerFile(home).input_tokens).toBe(0);
});

it("daily caps: keeps the ledger when the platform refuses chmod", async () => {
  const home = plantDir();
  vi.spyOn(fs, "chmodSync").mockImplementation(() => {
    throw new Error("EPERM");
  });
  expect((await go({ home, fetchImpl: scripted(reply(200, answerBody())) })).code).toBe(0);
  expect(readLedgerFile(home).requests).toBe(1);
});
