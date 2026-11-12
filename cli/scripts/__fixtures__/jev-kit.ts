import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import type { Json } from "../../json.ts";
import { tempDir, useTempDirs } from "../../sync/__fixtures__/temp-dirs.ts";
import { createJevRunner } from "../create-jev-runner.ts";
import { MODEL } from "../jev.constants.ts";
import type { JevFetch, JevInit, JevResponse, JevRunOpts } from "../jev.types.ts";

useTempDirs();

/** A fresh planted directory, removed after the case. */
export function plantDir(prefix = "jev-"): string {
  return tempDir(prefix);
}

export const KEY = "ts_live_test_key";
export const QUESTIONS = JSON.stringify({ q: { type: "choice", instructions: "Which?", criteria: { a: "x", b: "y" } } });
/** A fixed clock so the daily ledger lands on a known day. */
export const NOW = Date.parse("2026-10-09T12:00:00Z");
export const DAY = "2026-10-09";

export function answerBody(extra: Record<string, unknown> = {}) {
  return {
    model: MODEL,
    answers: { q: { type: "choice", choice: "a", confidence: 0.9 } },
    usage: { input_tokens: 10 },
    ...extra,
  };
}

export function reply(status: number, body: Json, headers: Record<string, string> = {}): JevResponse {
  return { status, json: () => Promise.resolve(body), headers: new Headers(headers) };
}

/** A fetch that answers from a script, one entry per call, and records the call count. */
export function scripted(...replies: (JevResponse | Error)[]): JevFetch & { calls: number } {
  const state = { calls: 0 };
  const fn: JevFetch = () => {
    const next = replies[Math.min(state.calls, replies.length - 1)] ?? new Error("no scripted reply");
    state.calls += 1;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return Object.defineProperty(fn, "calls", { get: () => state.calls }) as JevFetch & { calls: number };
}

export function ledgerFile(home: string): string {
  return path.join(home, ".workerstack", "jev-usage.json");
}

export function readLedgerFile(home: string): { day: string; requests: number; input_tokens: number } {
  return JSON.parse(fs.readFileSync(ledgerFile(home), "utf8")) as { day: string; requests: number; input_tokens: number };
}

export function plantLedger(home: string, content: unknown): void {
  fs.mkdirSync(path.join(home, ".workerstack"), { recursive: true });
  fs.writeFileSync(ledgerFile(home), typeof content === "string" ? content : JSON.stringify(content));
}

/** One fresh runner call with a key, a fixed clock and a small question set. */
export function go(over: JevRunOpts) {
  return createJevRunner()({ home: plantDir(), env: { TYPESAFE_API_KEY: KEY }, now: () => NOW, stateText: "page", questionsText: QUESTIONS, ...over });
}

/** A sleep that records its waits and returns at once. */
export function sleeper() {
  const waits: number[] = [];
  return { waits, sleep: (ms: number) => Promise.resolve(void waits.push(ms)) };
}

export function lockPath(home: string): string {
  return path.join(home, ".workerstack", "jev-usage.lock");
}

export function plantLock(home: string): void {
  fs.mkdirSync(lockPath(home), { recursive: true });
}

/** Replaces stdout's write for the case (restore with vi.restoreAllMocks) and returns what was written. */
export function captureStdout(): string[] {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => writes.push(String(chunk)) > 0);
  return writes;
}

/** One choice question about which endpoint the app should call. */
export const ENDPOINT_QUESTIONS = JSON.stringify({
  endpoint: {
    criteria: { other: "a different host", typesafe: "vendor host" },
    instructions: "Which endpoint should the app call?",
    type: "choice",
  },
});

/** An answer picking `typesafe` with this confidence, charged 120 input tokens. */
export function choiceBody(confidence = 0.91) {
  return {
    answers: {
      endpoint: {
        choice: "typesafe",
        confidence,
        probabilities: { other: 0.06, typesafe: 0.94 },
        type: "choice",
      },
    },
    model: MODEL,
    usage: { input_tokens: 120, output_tokens: 4 },
  };
}

export function jsonResponse(status: number, body: Json, headers: Record<string, string> = {}): JevResponse {
  return {
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    status,
  };
}

/** A fetch answering each call from `respond` (given the call's 1-based number), recording every call. */
export function counted(respond: (n: number, url: string, init: JevInit) => JevResponse) {
  const calls: { url: string; init: JevInit }[] = [];
  const fetchImpl: JevFetch = (url, init) => {
    calls.push({ init, url });
    return Promise.resolve(respond(calls.length, url, init));
  };
  return { calls, fetchImpl };
}

/** A home whose ledger for today already holds these counts. */
export function homeAtCap(prefix: string, counts: { input_tokens: number; requests: number }): string {
  const home = plantDir(prefix);
  plantLedger(home, `${JSON.stringify({ day: new Date().toISOString().slice(0, 10), ...counts })}\n`);
  return home;
}
