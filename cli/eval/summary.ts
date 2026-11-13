/** The one JSON file a paid eval run leaves behind: what it was asked, what it cost and how it ended. */
import { randomBytes } from "node:crypto";
import path from "node:path";

import { writeAtomic } from "../sync/migrate-fs.ts";
import type { Via } from "./estimate.ts";
import type { RunResult } from "./run.ts";

const SUFFIX_BYTES = 2;
const JSON_INDENT = 2;

/** The ISO punctuation a stamp drops. */
const STAMP_PUNCTUATION = /[-:.]/g;

export type SummaryInput = { eval: string; model: string; cap: number; estimate: number; run: RunResult; via: Via };

/** `20261113T100655123Z`: the UTC clock down to the millisecond. */
function stampOf(now: Date): string {
  return now.toISOString().replaceAll(STAMP_PUNCTUATION, "");
}

/** Writes the summary to `<dir>/<eval>-<stamp>-<hex>.json` and returns that absolute path. */
export function writeSummary(dir: string, input: SummaryInput, now: Date): string {
  const name = `${input.eval}-${stampOf(now)}-${randomBytes(SUFFIX_BYTES).toString("hex")}.json`;
  const file = path.resolve(dir, name);
  const { run } = input;

  const body = {
    cached: run.cached,
    calls: run.calls,
    cap: input.cap,
    cases: run.cases,
    end: run.end,
    estimate: input.estimate,
    eval: input.eval,
    model: input.model,
    spent: run.spent,
    via: input.via,
  };

  writeAtomic(file, `${JSON.stringify(body, null, JSON_INDENT)}\n`);

  return file;
}
