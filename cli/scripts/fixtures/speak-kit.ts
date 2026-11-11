import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { loadCfg } from "../speak-config.ts";
import type { FetchFn, FetchResult, SpeakCfg } from "../speak.types.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh planted directory, removed after the case. */
export function plantDir(prefix = "speak-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Plants ~/.workerstack/speak.json under a planted home. */
export function plantSpeakJson(home: string, content: unknown): void {
  fs.mkdirSync(path.join(home, ".workerstack"), { recursive: true });
  fs.writeFileSync(path.join(home, ".workerstack", "speak.json"), typeof content === "string" ? content : JSON.stringify(content));
}

/** A config built from env keys alone, over a planted empty home. */
export function cfgOf(env: Record<string, string>): SpeakCfg {
  return loadCfg({ env, home: plantDir("speak-cfg-") });
}

export function okRes(over: FetchResult = {}): FetchResult {
  return { ok: true, status: 200, ...over };
}

export function failRes(status: number, text: string): FetchResult {
  return { ok: false, status, text: () => Promise.resolve(text) };
}

/** Collects what main logs. */
export function collector() {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    logs,
    errs,
    log: {
      log: (m: string) => void logs.push(m),
      error: (m: string) => void errs.push(m),
    },
  };
}

/** A fetch that always answers with `res`; null models a fetch that hands back nothing. */
export function fetchReturning(res: FetchResult | null): FetchFn {
  return () => Promise.resolve(res);
}

/** A fetch that always fails with `what`, an Error or not. */
export function fetchThrowing(what: unknown): FetchFn {
  return () => Promise.reject(what);
}

/** An ok response whose body parses to `value`. */
export function jsonRes(value: unknown): FetchResult {
  return okRes({ json: () => Promise.resolve(value) });
}

/** An ok response carrying these audio bytes. */
export function bytesRes(bytes: Uint8Array | ArrayBuffer): FetchResult {
  return okRes({ arrayBuffer: () => Promise.resolve(bytes) });
}
