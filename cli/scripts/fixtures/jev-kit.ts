import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, vi } from "vitest";
import { MODEL, createJevRunner } from "../jev.ts";
import type { JevFetch, JevResponse, JevRunOpts } from "../jev.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh planted directory, removed after the case. */
export function plantDir(prefix = "jev-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
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

export function reply(status: number, body: unknown, headers?: Record<string, string>): JevResponse {
  const lower = headers && Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    json: () => Promise.resolve(body),
    ...(lower ? { headers: { get: (name: string) => lower[name.toLowerCase()] ?? null } } : {}),
  };
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
  return createJevRunner()({ home: plantDir(), env: { TYPESAFE_API_KEY: KEY }, now: NOW, stateText: "page", questionsText: QUESTIONS, ...over });
}

/** A sleep that records its waits and returns at once. */
export function sleeper() {
  const waits: number[] = [];
  return { waits, sleep: (ms: number) => Promise.resolve(void waits.push(ms)) };
}

/** A response whose headers are a plain map, or nothing. */
export function plainReply(status: number, headers: Record<string, string> | null): JevResponse {
  return { status, json: () => Promise.resolve(null), headers };
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
