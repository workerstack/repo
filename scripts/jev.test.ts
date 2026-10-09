import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ENDPOINT,
  MODEL,
  createJevRunner,
  estimateTokens,
  jevUsagePath,
  main,
} from "./jev.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

const QUESTIONS = JSON.stringify({
  endpoint: {
    type: "choice",
    instructions: "Which endpoint should the app call?",
    criteria: { typesafe: "vendor host", other: "a different host" },
  },
});

function choiceBody(confidence = 0.91) {
  return {
    model: MODEL,
    answers: {
      endpoint: {
        type: "choice",
        choice: "typesafe",
        confidence,
        probabilities: { typesafe: 0.94, other: 0.06 },
      },
    },
    usage: { input_tokens: 120, output_tokens: 4 },
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

describe("runJev", () => {
  it("posts one pinned choice and stores the real input token count", async () => {
    const home = tmp("jev-ok-");
    const key = "ts_live_test_key";
    const state = "docs say POST /v1/systemone";
    const calls: unknown[] = [];
    const fetchImpl = async (url: string, init: { body?: string; headers?: Record<string, string> }) => {
      calls.push({ url, init });
      return jsonResponse(200, choiceBody());
    };
    const run = createJevRunner();
    const result = await run({
      home,
      env: { TYPESAFE_API_KEY: key },
      fetchImpl,
      stateText: state,
      questionsText: QUESTIONS,
    });
    expect(result.code).toBe(0);
    expect(result.text).toContain(`${MODEL}. input_tokens=120`);
    expect(result.text).toContain("- endpoint choice=typesafe confidence=0.91");
    expect(result.text).not.toContain(key);
    expect(calls).toHaveLength(1);
    const hit = calls[0] as { url: string; init: { body: string; headers: Record<string, string> } };
    expect(hit.url).toBe(ENDPOINT);
    expect(hit.init.headers.Authorization).toBe(`Bearer ${key}`);
    const sent = JSON.parse(hit.init.body);
    expect(sent.model).toBe(MODEL);
    expect(sent.state).toBe(state);
    expect(sent.questions.endpoint.type).toBe("choice");
    expect(JSON.stringify(sent)).not.toContain(key);
    const ledger = JSON.parse(fs.readFileSync(jevUsagePath(home), "utf8"));
    expect(ledger.requests).toBe(1);
    expect(ledger.input_tokens).toBe(120);
    expect(ledger.input_tokens).not.toBe(estimateTokens(state, QUESTIONS));
    const again = await run({
      home,
      env: { TYPESAFE_API_KEY: key },
      fetchImpl,
      stateText: state,
      questionsText: QUESTIONS,
    });
    expect(again.code).toBe(2);
    expect(again.text).toBe("process request cap 1\n");
    expect(calls).toHaveLength(1);
  });

  it("prints a low-confidence choice and does not call again", async () => {
    const home = tmp("jev-low-");
    let n = 0;
    const run = createJevRunner();
    const result = await run({
      home,
      env: { TYPESAFE_API_KEY: "ts_live_test_key" },
      fetchImpl: async () => {
        n += 1;
        return jsonResponse(200, choiceBody(0.1));
      },
      stateText: "page text",
      questionsText: QUESTIONS,
    });
    expect(result.code).toBe(0);
    expect(result.text).toContain("confidence=0.1");
    expect(n).toBe(1);
  });

  it("sends a JSON state object", async () => {
    const home = tmp("jev-json-");
    let sent = "";
    const run = createJevRunner();
    await run({
      home,
      env: { TYPESAFE_API_KEY: "ts_live_test_key" },
      fetchImpl: async (_url: string, init: { body: string }) => {
        sent = init.body;
        return jsonResponse(200, {
          model: MODEL,
          answers: { keep: { type: "noul", noul: 0.2 } },
          usage: { input_tokens: 10 },
        });
      },
      stateText: '{"page":"privacy"}\n',
      questionsText: JSON.stringify({
        keep: { type: "noul", instructions: "Does this promise zero retention?" },
      }),
    });
    expect(JSON.parse(sent).state).toEqual({ page: "privacy" });
  });

  it("does not fetch when the key, question count, state, or ledger already blocks", async () => {
    const questions = QUESTIONS;
    const state = "short";
    const cases: { name: string; homePrep?: (home: string) => void; stateText: string; questionsText: string; env: Record<string, string> }[] = [];
    const blocked = tmp("jev-block-");
    fs.mkdirSync(path.join(blocked, ".grunt"), { recursive: true });
    fs.writeFileSync(
      jevUsagePath(blocked),
      JSON.stringify({ day: new Date().toISOString().slice(0, 10), requests: 40, input_tokens: 0 }) + "\n",
    );
    const tokenHome = tmp("jev-tokens-");
    fs.mkdirSync(path.join(tokenHome, ".grunt"), { recursive: true });
    fs.writeFileSync(
      jevUsagePath(tokenHome),
      JSON.stringify({
        day: new Date().toISOString().slice(0, 10),
        requests: 0,
        input_tokens: 1_000_000,
      }) + "\n",
    );
    const fileKey = tmp("jev-file-");
    const runs = [
      {
        label: "missing key",
        home: tmp("jev-nokey-"),
        env: {},
        stateText: state,
        questionsText: questions,
        text: /missing TYPESAFE_API_KEY/,
      },
      {
        label: "nine questions",
        home: fileKey,
        env: { TYPESAFE_API_KEY: "ts_live_test_key" },
        stateText: state,
        questionsText: JSON.stringify(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`q${i}`, { type: "noul", instructions: "x" }]))),
        text: /questions exceed 8/,
      },
      {
        label: "huge state",
        home: fileKey,
        env: { TYPESAFE_API_KEY: "ts_live_test_key" },
        stateText: "x".repeat(64_001),
        questionsText: questions,
        text: /state exceeds 64000/,
      },
      {
        label: "request cap",
        home: blocked,
        env: { TYPESAFE_API_KEY: "ts_live_test_key" },
        stateText: state,
        questionsText: questions,
        text: /daily request cap 40/,
      },
      {
        label: "token cap",
        home: tokenHome,
        env: { TYPESAFE_API_KEY: "ts_live_test_key" },
        stateText: state,
        questionsText: questions,
        text: /daily input token cap 1000000/,
      },
    ];
    for (const row of runs) {
      let n = 0;
      const run = createJevRunner();
      const result = await run({
        home: row.home,
        env: row.env,
        fetchImpl: async () => {
          n += 1;
          return jsonResponse(200, choiceBody());
        },
        stateText: row.stateText,
        questionsText: row.questionsText,
      });
      expect(result.code, row.label).toBe(2);
      expect(result.text, row.label).toMatch(row.text);
      expect(n, row.label).toBe(0);
    }
    expect(cases).toHaveLength(0);
  });

  it("retries one 429 inside two seconds and counts both requests", async () => {
    const home = tmp("jev-429-");
    const state = "excerpt";
    const waits: number[] = [];
    let n = 0;
    const run = createJevRunner();
    const result = await run({
      home,
      env: { TYPESAFE_API_KEY: "ts_live_test_key" },
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      fetchImpl: async () => {
        n += 1;
        if (n === 1) return jsonResponse(429, { error: "slow" }, { "retry-after": "1" });
        return jsonResponse(200, choiceBody());
      },
      stateText: state,
      questionsText: QUESTIONS,
    });
    expect(result.code).toBe(0);
    expect(waits).toEqual([1000]);
    expect(n).toBe(2);
    const ledger = JSON.parse(fs.readFileSync(jevUsagePath(home), "utf8"));
    expect(ledger.requests).toBe(2);
    expect(ledger.input_tokens).toBe(estimateTokens(state, QUESTIONS) + 120);
  });

  it("does not retry when Retry-After is over two seconds or the status is 401", async () => {
    const home = tmp("jev-noretry-");
    const secretState = "SECRET_STATE_BODY";
    let tooSlow = 0;
    const slow = createJevRunner();
    const slowResult = await slow({
      home,
      env: { TYPESAFE_API_KEY: "ts_live_test_key" },
      sleep: async () => {
        throw new Error("slept");
      },
      fetchImpl: async () => {
        tooSlow += 1;
        return jsonResponse(429, { echo: secretState }, { "retry-after": "5" });
      },
      stateText: secretState,
      questionsText: QUESTIONS,
    });
    expect(slowResult.code).toBe(2);
    expect(slowResult.text).toBe("jev request failed\n");
    expect(slowResult.text).not.toContain(secretState);
    expect(tooSlow).toBe(1);

    let denied = 0;
    const auth = createJevRunner();
    const authResult = await auth({
      home: tmp("jev-401-"),
      env: { TYPESAFE_API_KEY: "ts_live_test_key" },
      fetchImpl: async () => {
        denied += 1;
        return jsonResponse(401, { echo: secretState });
      },
      stateText: secretState,
      questionsText: QUESTIONS,
    });
    expect(authResult.code).toBe(2);
    expect(authResult.text).not.toContain(secretState);
    expect(denied).toBe(1);
  });
});

describe("main", () => {
  it("reports key availability without a request or a setup error", async () => {
    const missing = await main(["--available"], { env: {}, home: tmp("jev-avail-no-") });
    expect(missing).toEqual({ code: 0, text: "no\n" });
    const home = tmp("jev-avail-yes-");
    fs.mkdirSync(path.join(home, ".grunt"), { recursive: true });
    fs.writeFileSync(path.join(home, ".grunt", "jev.json"), JSON.stringify({ apiKey: "ts_live_test_key" }));
    const present = await main(["--available"], { env: {}, home });
    expect(present).toEqual({ code: 0, text: "yes\n" });
    expect(present.text).not.toContain("ts_live_test_key");
  });

  it("exits 2 with usage and no key text when args are missing", async () => {
    const result = await main([], { env: { TYPESAFE_API_KEY: "ts_live_test_key" } });
    expect(result.code).toBe(2);
    expect(result.text).toMatch(/usage: node scripts\/jev\.mjs --available \| --state FILE --questions FILE/);
    expect(result.text).not.toContain("ts_live_test_key");
  });
});
