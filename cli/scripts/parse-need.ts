#!/usr/bin/env bun
/** Extract/validate a JSON `need:` array. Fail → stderr + exit 1. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const NEED_JOBS: Set<string> = new Set(["search", "exec", "web", "test", "slice", "fetch"]);

/** One validated job row. */
export interface NeedJob {
  job: string;
  query: string;
  stash?: string;
  path?: string;
  cwd?: string;
  glob?: string[];
  from?: string;
  to?: string;
}

export type NeedResult = { ok: true; jobs: NeedJob[] } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function parseNeed(text: unknown): NeedResult {
  const s = String(text ?? "");
  const m = s.match(/^\s*need:\s*(\[[\s\S]*\])\s*$/m);
  if (!m) {
    return { ok: false, error: "no json need array" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1] ?? "");
  } catch {
    return { ok: false, error: "invalid json" };
  }
  if (!Array.isArray(parsed) || parsed.length < 1) {
    return { ok: false, error: "need array empty" };
  }
  const jobs: NeedJob[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) {
      return { ok: false, error: "invalid job item" };
    }
    const rec = item;
    const job = String(rec.job ?? "").trim();
    const query = String(rec.query ?? "").trim();
    const stash = rec.stash != null ? String(rec.stash).trim() : "";
    if (!NEED_JOBS.has(job)) {
      return { ok: false, error: "invalid job or query" };
    }
    if (job === "slice") {
      if (!stash && !query) {
        return { ok: false, error: "invalid job or query" };
      }
    } else if (!query) {
      return { ok: false, error: "invalid job or query" };
    }
    const row: NeedJob = { job, query };
    if (job === "slice" && stash) row.stash = stash;
    else if (stash) row.stash = stash;
    if (rec.path != null && String(rec.path).trim()) {
      row.path = String(rec.path).trim();
    }
    if (rec.cwd != null && String(rec.cwd).trim()) {
      row.cwd = String(rec.cwd).trim();
    }
    if (rec.glob != null && rec.glob !== "") {
      row.glob = Array.isArray(rec.glob) ? rec.glob.map((g) => String(g)) : [String(rec.glob)];
    }
    if (rec.from != null && String(rec.from).trim()) {
      row.from = String(rec.from).trim();
    }
    if (rec.to != null && String(rec.to).trim()) {
      row.to = String(rec.to).trim();
    }
    if (job === "slice" && !row.stash && query) {
      row.stash = query;
    }
    jobs.push(row);
  }
  return { ok: true, jobs };
}

function main() {
  try {
    const arg = process.argv[2];
    const text = arg && arg !== "-" ? fs.readFileSync(arg, "utf8") : fs.readFileSync(0, "utf8");
    const result = parseNeed(text);
    if (!result.ok) {
      process.stderr.write(result.error + "\n");
      return 1;
    }
    process.stdout.write(JSON.stringify(result.jobs) + "\n");
    return 0;
  } catch {
    process.stderr.write("parse-need failed\n");
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  process.exit(main());
}
