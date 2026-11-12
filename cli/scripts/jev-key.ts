/** Where jev keeps its key and ledger, the key itself, the token estimate and the retry-after wait. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import { repoEnv, type Env } from "../repo-env.ts";
import { CHARS_PER_TOKEN, MAX_RETRY_WAIT_MS, MS_PER_SECOND } from "./jev.constants.ts";

const SECONDS_RE = /^\d+$/;

function jevJsonSchema() {
  return z.looseObject({ apiKey: z.string().optional() });
}

function jevJsonPath(home: string): string {
  return path.join(home, ".workerstack", "jev.json");
}

export function jevUsagePath(home: string): string {
  return path.join(home, ".workerstack", "jev-usage.json");
}

export function estimateTokens(stateText: string, questionsText: string): number {
  return Math.ceil((stateText.length + questionsText.length) / CHARS_PER_TOKEN);
}

export function loadJevKey({
  env = repoEnv.process,
  home = os.homedir(),
}: { env?: Env | undefined; home?: string | undefined } = {}): string {
  const fromEnv = (env.TYPESAFE_API_KEY ?? "").trim();

  if (fromEnv !== "") return fromEnv;

  try {
    return (tryJson(jevJsonSchema(), fs.readFileSync(jevJsonPath(home), "utf8"))?.apiKey ?? "").trim();
  } catch {
    return "";
  }
}

export function retryWaitMs(header: string | null | undefined, now: number = Date.now()): number | null {
  const raw = (header ?? "").trim();

  if (raw === "") return null;

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
