/** The daily request and input-token ledger: reserve before a call, settle to the real count after. */
import fs from "node:fs";

import { z } from "zod";

import { tryJson } from "../json.ts";
import { jevUsagePath } from "./jev-key.ts";
import { DAY_CHARS, MAX_INPUT_TOKENS_PER_DAY, MAX_REQUESTS_PER_DAY, SECRET_FILE_MODE } from "./jev.constants.ts";
import type { Begun, Ledger } from "./jev.types.ts";
import { withLock } from "./with-lock.ts";

/** What a settle needs: where, when, the reserved estimate and the real count. */
type Settle = { home: string; nowMs: number; estimate: number; actual: number };

function dayOf(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, DAY_CHARS);
}

/** The ledger file as writeLedger writes it; a missing count reads as 0. */
function ledgerSchema() {
  return z.looseObject({
    day: z.string(),
    input_tokens: z.number().default(0),
    requests: z.number().default(0),
  });
}

function readLedger(file: string, day: string): Ledger {
  let text: string;

  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { day, input_tokens: 0, requests: 0 };
  }

  const ledger = tryJson(ledgerSchema(), text);

  if (ledger?.day !== day) return { day, input_tokens: 0, requests: 0 };

  return { day, input_tokens: ledger.input_tokens, requests: ledger.requests };
}

function writeLedger(file: string, row: Ledger): void {
  fs.writeFileSync(file, `${JSON.stringify(row)}\n`, { mode: SECRET_FILE_MODE });

  try {
    fs.chmodSync(file, SECRET_FILE_MODE);
  } catch {
    // win
  }
}

/** Reserves one request and `estimate` tokens for today, or says which cap stops it. */
export function beginAttempt(home: string, nowMs: number, estimate: number): Begun | { busy: true } {
  return withLock<Begun>(home, () => {
    const file = jevUsagePath(home);
    const day = dayOf(nowMs);
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

/** Swaps today's reserved estimate for the real input-token count. */
export function settleTokens({ home, nowMs, estimate, actual }: Settle): { ok: true } | { busy: true } {
  return withLock(home, () => {
    const file = jevUsagePath(home);
    const day = dayOf(nowMs);
    const cur = readLedger(file, day);
    const inputTokens = Math.max(0, cur.input_tokens - estimate + actual);
    writeLedger(file, { day, input_tokens: inputTokens, requests: cur.requests });

    return { ok: true };
  });
}
