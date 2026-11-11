/** Where jev keeps its key and ledger, the key itself, the token estimate and the retry-after wait. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readEnv } from "../env.ts";
import type { Env } from "../env.ts";
import { isRecord } from "./hook-input.ts";
import { CHARS_PER_TOKEN, MAX_RETRY_WAIT_MS, MS_PER_SECOND } from "./jev.constants.ts";

const SECONDS_RE = /^\d+$/;

function jevJsonPath(home: string): string {
  return path.join(home, ".workerstack", "jev.json");
}

export function jevUsagePath(home: string): string {
  return path.join(home, ".workerstack", "jev-usage.json");
}

export function estimateTokens(stateText: unknown, questionsText: unknown): number {
  return Math.ceil((String(stateText).length + String(questionsText).length) / CHARS_PER_TOKEN);
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
  if (SECONDS_RE.test(raw)) {
    const ms = Number(raw) * MS_PER_SECOND;
    return ms <= MAX_RETRY_WAIT_MS ? ms : null;
  }
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  const ms = when - now;
  if (ms < 0) return 0;
  return ms <= MAX_RETRY_WAIT_MS ? ms : null;
}
