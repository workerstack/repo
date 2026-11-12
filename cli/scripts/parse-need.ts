#!/usr/bin/env bun
/** Extract/validate a JSON `need:` array; `orchestrate-parent.ts` calls `parseNeed`. */
import { NEED_JOBS, NEED_LINE, SLICE_JOB } from "./parse-need.constants.ts";

/** One validated job row. */
type NeedJob = {
  job: string;
  query: string;
  stash?: string;
  path?: string;
  cwd?: string;
  glob?: string[];
  from?: string;
  to?: string;
};

export type NeedResult = { ok: true; jobs: NeedJob[] } | { ok: false; error: string };

/** The fields a row keeps as trimmed text when they hold any. */
type TextField = "path" | "cwd" | "from" | "to";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** `value` as text when it is a JSON scalar (string, number, boolean); "" for null, undefined, objects and arrays. */
function scalarText(value: unknown): string {
  if (typeof value === "string") return value;

  return typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

/** `value` as trimmed text; "" for anything but a scalar. */
function text(value: unknown): string {
  return scalarText(value).trim();
}

/** `value` as a list of globs: each item of an array, else the one value; undefined for null, undefined and "". */
function globOf(value: unknown): string[] | undefined {
  if (value == null || value === "") return undefined;

  return Array.isArray(value) ? value.map(scalarText) : [scalarText(value)];
}

/** Sets `row[field]` to the trimmed text of `rec[field]` when it holds any. */
function copyText(row: NeedJob, rec: Record<string, unknown>, field: TextField): void {
  const value = text(rec[field]);

  if (value !== "") row[field] = value;
}

/** The row `rec` asks for, or null when its job is unknown or it names no query (nor a stash, for a slice). */
function jobRow(rec: Record<string, unknown>): NeedJob | null {
  const job = text(rec.job);
  const query = text(rec.query);
  const stash = text(rec.stash);

  if (!NEED_JOBS.has(job) || (query === "" && (job !== SLICE_JOB || stash === ""))) return null;
  const row: NeedJob = { job, query };

  if (stash !== "") row.stash = stash;
  copyText(row, rec, "path");
  copyText(row, rec, "cwd");
  const glob = globOf(rec.glob);

  if (glob !== undefined) row.glob = glob;
  copyText(row, rec, "from");
  copyText(row, rec, "to");

  if (job === SLICE_JOB && row.stash === undefined) row.stash = query;

  return row;
}

export function parseNeed(input: string | null | undefined): NeedResult {
  const m = NEED_LINE.exec(input ?? "");

  if (m === null) return { error: "no json need array", ok: false };

  let parsed: unknown;

  try {
    parsed = JSON.parse(m[1] /* the pattern has one group, set whenever it matches */ as string);
  } catch {
    return { error: "invalid json", ok: false };
  }

  if (!Array.isArray(parsed) || parsed.length < 1) return { error: "need array empty", ok: false };

  const jobs: NeedJob[] = [];

  for (const item of parsed) {
    if (!isRecord(item)) return { error: "invalid job item", ok: false };
    const row = jobRow(item);

    if (row === null) return { error: "invalid job or query", ok: false };
    jobs.push(row);
  }

  return { jobs, ok: true };
}
