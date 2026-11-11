#!/usr/bin/env bun
/** One TypeSafe System One call for an external research decision. Caps are local. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readEnv } from "../env.ts";
import type { Env } from "../env.ts";
import { isRecord } from "./hook-input.ts";

export type JevResult = {
  code: number;
  text: string;
};

/** The request init this script sends; every field is always set. */
export type JevInit = {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};

export type HeadersLike = { get(name: string): string | null } | Record<string, string>;

export type JevResponse = {
  status: number;
  json: () => Promise<unknown>;
  headers?: HeadersLike | null;
};

export type JevFetch = (url: string, init: JevInit) => Promise<JevResponse>;

export type JevRunOpts = {
  home?: string | undefined;
  env?: Env | undefined;
  fetchImpl?: JevFetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: number | (() => number) | undefined;
  stateText?: unknown;
  questionsText?: unknown;
};

export type JevRun = (opts?: JevRunOpts) => Promise<JevResult>;

export type JevMainOpts = {
  run?: JevRun;
} & Omit<JevRunOpts, "stateText" | "questionsText">;

type Ledger = {
  day: string;
  requests: number;
  input_tokens: number;
};

type PostResult = {
  status: number;
  json: unknown;
  headers: HeadersLike | null | undefined;
};

type Attempt = { fail: JevResult } | { response: PostResult; nowMs: number };

type Begun = { busy: true } | { stop: "requests" | "tokens" } | { ok: true; estimate: number };

function isErrno(err: unknown, code: string): boolean {
  return isRecord(err) && err.code === code;
}

export const MODEL = "jev-1.13.0";
export const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const MAX_STATE_CHARS = 64_000;
export const MAX_QUESTIONS = 8;
export const MAX_REQUESTS_PER_DAY = 40;
export const MAX_INPUT_TOKENS_PER_DAY = 1_000_000;
export const TIMEOUT_MS = 10_000;
export const MAX_RETRY_WAIT_MS = 2_000;
export const LOCK_STALE_MS = 10_000;

const USAGE = "usage: bun repo jev --available | --state FILE --questions FILE\n";
const MISSING_KEY = "missing TYPESAFE_API_KEY or ~/.workerstack/jev.json. setup: bun repo setup jev\n";

export function jevJsonPath(home: string): string {
  return path.join(home, ".workerstack", "jev.json");
}

export function jevUsagePath(home: string): string {
  return path.join(home, ".workerstack", "jev-usage.json");
}

export function estimateTokens(stateText: unknown, questionsText: unknown): number {
  return Math.ceil((String(stateText).length + String(questionsText).length) / 4);
}

export function loadJevKey({
  env = readEnv(),
  home = os.homedir(),
}: { env?: Env | undefined; home?: string | undefined } = {}): string {
  const fromEnv = String(env.TYPESAFE_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(jevJsonPath(home), "utf8"));
    return String(isRecord(parsed) && parsed.apiKey ? parsed.apiKey : "").trim();
  } catch {
    return "";
  }
}

export function retryWaitMs(header: unknown, now: number = Date.now()): number | null {
  if (header == null || String(header).trim() === "") return null;
  const raw = String(header).trim();
  if (/^\d+$/.test(raw)) {
    const ms = Number(raw) * 1000;
    return ms <= MAX_RETRY_WAIT_MS ? ms : null;
  }
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  const ms = when - now;
  if (ms < 0) return 0;
  return ms <= MAX_RETRY_WAIT_MS ? ms : null;
}

function fail(text: string): JevResult {
  return { code: 2, text };
}

function headerGet(headers: HeadersLike | null | undefined, name: string): unknown {
  if (!headers) return null;
  if ("get" in headers && typeof headers.get === "function") return headers.get(name);
  const plain: Record<string, string> = headers as Record<string, string>; // not a Headers object, so a plain map
  return plain[name] ?? null;
}

function readLedger(file: string, day: string): Ledger {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isRecord(parsed) || parsed.day !== day) return { day, input_tokens: 0, requests: 0 };
    return {
      day,
      input_tokens: Number(parsed.input_tokens) || 0,
      requests: Number(parsed.requests) || 0,
    };
  } catch {
    return { day, input_tokens: 0, requests: 0 };
  }
}

function writeLedger(file: string, row: Ledger): void {
  fs.writeFileSync(file, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // win
  }
}

function withLock<T>(home: string, fn: () => T): T | { busy: true } {
  const dir = path.join(home, ".workerstack");
  fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  const lock = path.join(dir, "jev-usage.lock");
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (err) {
      if (!isErrno(err, "EEXIST")) throw err;
      let stale = false;
      try {
        stale = Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS;
      } catch {
        stale = true;
      }
      if (stale) {
        try {
          fs.rmdirSync(lock);
        } catch {
          // owner still has it
        }
        continue;
      }
      if (Date.now() - start > LOCK_STALE_MS) return { busy: true };
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.rmdirSync(lock);
    } catch {
      // already gone
    }
  }
}

function beginAttempt(home: string, nowMs: number, estimate: number): Begun | { busy: true } {
  return withLock<Begun>(home, () => {
    const file = jevUsagePath(home);
    const day = new Date(nowMs).toISOString().slice(0, 10);
    const cur = readLedger(file, day);
    if (cur.requests >= MAX_REQUESTS_PER_DAY) return { stop: "requests" };
    if (cur.input_tokens >= MAX_INPUT_TOKENS_PER_DAY || cur.input_tokens + estimate > MAX_INPUT_TOKENS_PER_DAY)
      return { stop: "tokens" };

    const next = {
      day,
      input_tokens: cur.input_tokens + estimate,
      requests: cur.requests + 1,
    };
    writeLedger(file, next);
    return { estimate, ok: true };
  });
}

function settleTokens(home: string, nowMs: number, estimate: number, actual: number): { ok: true } | { busy: true } {
  return withLock(home, () => {
    const file = jevUsagePath(home);
    const day = new Date(nowMs).toISOString().slice(0, 10);
    const cur = readLedger(file, day);
    const input_tokens = Math.max(0, cur.input_tokens - estimate + actual);
    writeLedger(file, { day, input_tokens, requests: cur.requests });
    return { ok: true };
  });
}

function parseState(stateText: string): unknown {
  const trimmed = stateText.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return stateText;
  try {
    // Text that opens with { or [ parses to an object or array, never null.
    return JSON.parse(stateText);
  } catch {
    return stateText;
  }
}

function formatAnswers(payload: Record<string, unknown>): string {
  const model = String(payload.model || MODEL);
  const used = Number(isRecord(payload.usage) ? payload.usage.input_tokens : payload.usage);
  const lines = [`${model}. input_tokens=${Number.isFinite(used) ? used : 0}`];
  const answers = isRecord(payload.answers) ? payload.answers : {};
  for (const [id, answer] of Object.entries(answers)) {
    if (lines.length >= 8) break;
    if (!isRecord(answer)) continue;
    if (answer.type === "choice") lines.push(`- ${id} choice=${answer.choice} confidence=${answer.confidence}`);
    else if (answer.type === "noul") lines.push(`- ${id} noul=${answer.noul}`);
    else if (answer.type === "score") lines.push(`- ${id} score=${answer.score} confidence=${answer.confidence}`);
  }
  return `${lines.join("\n")}\n`;
}

async function postOnce(
  fetchImpl: JevFetch,
  key: string,
  state: unknown,
  questions: Record<string, unknown>,
): Promise<PostResult> {
  const response = await fetchImpl(ENDPOINT, {
    body: JSON.stringify({ model: MODEL, questions, state }),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { headers: response.headers, json, status: response.status };
}

function stopText(kind: string): string {
  if (kind === "requests") return `daily request cap ${MAX_REQUESTS_PER_DAY}\n`;
  if (kind === "tokens") return `daily input token cap ${MAX_INPUT_TOKENS_PER_DAY}\n`;
  return "jev usage lock busy\n";
}

export function createJevRunner(): JevRun {
  let spent = false;
  return async function runJev(opts: JevRunOpts = {}): Promise<JevResult> {
    if (spent) return fail("process request cap 1\n");
    const home = opts.home || os.homedir();
    const env = opts.env ?? readEnv();
    // The global fetch returns a Response, which carries every JevResponse field.
    const fetchImpl: JevFetch = opts.fetchImpl ?? globalThis.fetch;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const nowOpt = opts.now;
    const nowFn: () => number = typeof nowOpt === "function" ? nowOpt : () => nowOpt ?? Date.now();
    const stateText = opts.stateText;
    const questionsText = opts.questionsText;
    if (typeof stateText !== "string" || typeof questionsText !== "string") return fail(USAGE);

    if (stateText.length > MAX_STATE_CHARS) return fail("state exceeds 64000 characters\n");
    let parsedQuestions: unknown;
    try {
      parsedQuestions = JSON.parse(questionsText);
    } catch {
      return fail("questions must be a JSON object\n");
    }
    if (!isRecord(parsedQuestions)) return fail("questions must be a JSON object\n");

    const questions = parsedQuestions;
    const count = Object.keys(questions).length;
    if (count < 1) return fail("questions missing\n");
    if (count > MAX_QUESTIONS) return fail("questions exceed 8\n");
    const key = loadJevKey({ env, home });
    if (!key) return fail(MISSING_KEY);
    const estimate = estimateTokens(stateText, questionsText);
    const state = parseState(stateText);

    const attempt = async (): Promise<Attempt> => {
      const nowMs = nowFn();
      const begun = beginAttempt(home, nowMs, estimate);
      if ("busy" in begun) return { fail: fail(stopText("lock")) };
      if ("stop" in begun) return { fail: fail(stopText(begun.stop)) };
      spent = true;
      let response: PostResult;
      try {
        response = await postOnce(fetchImpl, key, state, questions);
      } catch {
        return { fail: fail("jev request failed\n") };
      }
      return { nowMs, response };
    };

    const first = await attempt();
    if ("fail" in first) return first.fail;
    let { response, nowMs } = first;
    if (response.status === 429 || response.status === 529) {
      const wait = retryWaitMs(headerGet(response.headers, "retry-after"), nowMs);
      if (wait != null) {
        await sleep(wait);
        const second = await attempt();
        if ("fail" in second) return second.fail;
        response = second.response;
        nowMs = second.nowMs;
      }
    }
    const body = response.json;
    if (response.status < 200 || response.status >= 300 || !isRecord(body)) return fail("jev request failed\n");

    const actual = Number(isRecord(body.usage) ? body.usage.input_tokens : body.usage);
    if (Number.isFinite(actual) && actual >= 0) settleTokens(home, nowMs, estimate, actual);
    const text = formatAnswers(body);
    if (text.includes(key)) return fail("jev request failed\n");
    return { code: 0, text };
  };
}

export function parseArgv(argv: unknown): { flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  const args: unknown[] = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== "string" || !arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 2) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const name = arg.slice(2);
    const next = args[i + 1];
    if (next && !String(next).startsWith("--")) {
      flags[name] = String(next);
      i += 1;
    } else {
      flags[name] = "1";
    }
  }
  return { flags };
}

const runner = createJevRunner();

export async function runJev(argv: string[], opts: JevMainOpts = {}): Promise<JevResult> {
  const { flags } = parseArgv(argv);
  if (flags.available) {
    const present = Boolean(loadJevKey({ env: opts.env ?? readEnv(), home: opts.home || os.homedir() }));
    return { code: 0, text: present ? "yes\n" : "no\n" };
  }
  if (!flags.state || !flags.questions) return fail(USAGE);
  let stateText: string;
  let questionsText: string;
  try {
    stateText = fs.readFileSync(flags.state, "utf8");
    questionsText = fs.readFileSync(flags.questions, "utf8");
  } catch {
    return fail("state or questions file missing\n");
  }
  const run = opts.run ?? runner;
  return run({
    env: opts.env,
    fetchImpl: opts.fetchImpl,
    home: opts.home,
    now: opts.now,
    questionsText,
    sleep: opts.sleep,
    stateText,
  });
}

export async function main(argv: string[]): Promise<number> {
  try {
    const result = await runJev(argv);
    process.stdout.write(result.text);
    return result.code;
  } catch {
    process.stdout.write("jev request failed\n");
    return 2;
  }
}
