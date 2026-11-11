import { afterEach, expect, it, vi } from "vitest";

import { KEY, NOW, QUESTIONS, answerBody, go, plantDir, reply, scripted } from "./__fixtures__/jev-kit.ts";
import { createJevRunner } from "./create-jev-runner.ts";
import { isRecord } from "./hook-input.ts";
import { MAX_QUESTIONS, MAX_STATE_CHARS, MODEL } from "./jev.constants.ts";

afterEach(() => vi.unstubAllGlobals());

it("rejecting input before any request: needs both texts as strings", async () => {
  const fetchImpl = scripted(reply(200, answerBody()));
  const bad = [{ stateText: undefined }, { questionsText: 5 }, { stateText: null }];
  const outs = await Promise.all(bad.map((one) => go({ fetchImpl, ...one })));
  expect(outs.map((out) => out.code)).toStrictEqual([2, 2, 2]);
  expect(outs.every((out) => out.text.startsWith("usage: "))).toBe(true);
  expect(fetchImpl.calls).toBe(0);
});

it("rejecting input before any request: rejects state over the cap and malformed question sets", async () => {
  const fetchImpl = scripted(reply(200, answerBody()));
  const over = await go({ fetchImpl, stateText: "x".repeat(MAX_STATE_CHARS + 1) });
  expect(over.text).toBe("state exceeds 64000 characters\n");
  const atCap = await go({ fetchImpl, stateText: "x".repeat(MAX_STATE_CHARS) });
  expect(atCap.code).toBe(0);
  const malformed = ["{broken", "[]", "null", "3"].map((questionsText) => go({ fetchImpl, questionsText }));
  const refusals = await Promise.all(malformed);
  expect(refusals).toStrictEqual(
    Array.from({ length: 4 }, () => ({ code: 2, text: "questions must be a JSON object\n" })),
  );
  const empty = await go({ fetchImpl, questionsText: "{}" });
  expect(empty.text).toBe("questions missing\n");
  const many = Object.fromEntries(Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => [`q${i}`, {}]));
  const tooMany = await go({ fetchImpl, questionsText: JSON.stringify(many) });
  expect(tooMany.text).toBe("questions exceed 8\n");
  expect(fetchImpl.calls).toBe(1);
});

it("rejecting input before any request: names the setup step when there is no key", async () => {
  const fetchImpl = scripted(reply(200, answerBody()));
  const out = await go({ env: {}, fetchImpl });
  expect(out.code).toBe(2);
  expect(out.text).toContain("bun repo setup jev");
  expect(fetchImpl.calls).toBe(0);
});

it("what is sent: sends non-JSON state as text and JSON-looking state as data", async () => {
  const sent: unknown[] = [];
  function fetchImpl(_url: string, init: { body: string }) {
    const body: unknown = JSON.parse(init.body);
    sent.push(isRecord(body) ? body.state : undefined);
    return Promise.resolve(reply(200, answerBody()));
  }
  await go({ fetchImpl, stateText: "plain words" });
  await go({ fetchImpl, stateText: ' {"a":1}' });
  await go({ fetchImpl, stateText: "[1,2]" });
  await go({ fetchImpl, stateText: "{not json" });
  expect(sent).toStrictEqual(["plain words", { a: 1 }, [1, 2], "{not json"]);
});

it("what is sent: uses the clock when no time is injected, and waits on the real timer", async () => {
  const out = await createJevRunner()({
    env: { TYPESAFE_API_KEY: KEY },
    fetchImpl: scripted(reply(429, null, { "retry-after": "0" }), reply(200, answerBody())),
    home: plantDir(),
    questionsText: QUESTIONS,
    stateText: "s",
  });
  expect(out.code).toBe(0);
});

it("what is sent: takes a clock function", async () => {
  const out = await go({ fetchImpl: scripted(reply(200, answerBody())), now: () => NOW });
  expect(out.code).toBe(0);
});

it("reading the reply: prints each answer type and skips malformed ones", async () => {
  const body = answerBody({
    answers: {
      a: { choice: "x", confidence: 0.5, type: "choice" },
      b: { noul: true, type: "noul" },
      c: { confidence: 0.7, score: 3, type: "score" },
      d: { type: "unknown" },
      e: "not a record",
    },
  });
  const out = await go({ fetchImpl: scripted(reply(200, body)) });
  expect(out).toStrictEqual({
    code: 0,
    text: `${MODEL}. input_tokens=10\n- a choice=x confidence=0.5\n- b noul=true\n- c score=3 confidence=0.7\n`,
  });
});

it("reading the reply: prints at most eight lines", async () => {
  const answers = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, { noul: i, type: "noul" }]));
  const out = await go({
    fetchImpl: scripted(reply(200, answerBody({ answers }))),
    questionsText: JSON.stringify(Object.fromEntries(Object.keys(answers).map((k) => [k, {}]))),
  });
  expect(out.text.trimEnd().split("\n")).toHaveLength(8);
});

it("reading the reply: reports zero tokens and the pinned model when the reply omits them", async () => {
  const odd = await go({ fetchImpl: scripted(reply(200, { answers: "none", usage: "many" })) });
  expect(odd).toStrictEqual({ code: 0, text: `${MODEL}. input_tokens=0\n` });
  const numeric = await go({ fetchImpl: scripted(reply(200, { model: "other", usage: 7 })) });
  expect(numeric.text).toBe("other. input_tokens=7\n");
});

it("reading the reply: fails without echoing a reply that contains the key", async () => {
  const out = await go({ fetchImpl: scripted(reply(200, answerBody({ model: KEY }))) });
  expect(out).toStrictEqual({ code: 2, text: "jev request failed\n" });
});

it("reading the reply: fails on a bad status, an unreadable body, a non-object body or a failed request", async () => {
  const failed = { code: 2, text: "jev request failed\n" };
  expect(await go({ fetchImpl: scripted(reply(500, answerBody())) })).toStrictEqual(failed);
  expect(await go({ fetchImpl: scripted(reply(199, answerBody())) })).toStrictEqual(failed);
  expect(await go({ fetchImpl: scripted(reply(200, [1])) })).toStrictEqual(failed);
  const unreadable = { json: () => Promise.reject(new Error("bad json")), status: 200 };
  expect(await go({ fetchImpl: scripted(unreadable) })).toStrictEqual(failed);
  expect(await go({ fetchImpl: scripted(new Error("network down")) })).toStrictEqual(failed);
});

it("reading the reply: uses the global fetch when none is injected", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    calls.push(url);
    return Promise.resolve(new Response(JSON.stringify(answerBody()), { status: 200 }));
  });
  const out = await go({});
  expect(out.code).toBe(0);
  expect(calls).toStrictEqual(["https://api.typesafe.ai/v1/systemone"]);
});
