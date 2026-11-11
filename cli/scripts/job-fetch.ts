import { spawnSync } from "node:child_process";
import { childEnv } from "../env.ts";
import {
  BUFFER_SLACK,
  EMPTY_PAGE,
  EXEC_JOB,
  FETCH_FAILED,
  FETCH_SCRIPT,
  FETCH_TIMEOUT_MS,
  HTTP_URL,
  LINE_WIDTH,
  STASH_CAP,
} from "./job.constants.ts";
import { failedResult, nonEmptyLines } from "./job-exec.ts";
import { fallbackResult, verdictFromLines } from "./job-format.ts";
import type { FetchOptions, JobResult } from "./job.types.ts";

/** A page's title and its visible text on one line. */
export function stripHtml(html: unknown): { title: string; text: string } {
  const s = String(html || "");
  const title = /<title[^>]*>(?<title>[\s\S]*?)<\/title>/i.exec(s)?.groups?.title || "";
  const text = s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return { title: title.replace(/\s+/g, " ").trim(), text };
}

/** The page's title, then its text one sentence a line. */
function pageLines(raw: string): string[] {
  const { title, text } = stripHtml(raw);
  const lines: string[] = [];
  if (title) lines.push(title);
  for (const part of text.split(/(?<=\.)\s+/)) {
    const p = part.trim();
    if (p) lines.push(p.slice(0, LINE_WIDTH));
  }
  return lines.length ? lines : [EMPTY_PAGE];
}

/** Fetches an http url in a child and prints the page as text facts; any other query falls back. */
export function runFetch(query: string, { cwd, root, timeoutMs = FETCH_TIMEOUT_MS }: FetchOptions = {}): JobResult {
  const url = String(query || "").trim();
  if (!HTTP_URL.test(url)) return fallbackResult();
  const r = spawnSync(process.execPath, ["-e", FETCH_SCRIPT, url], {
    encoding: "utf8",
    cwd: cwd || process.cwd(),
    timeout: timeoutMs,
    maxBuffer: STASH_CAP + BUFFER_SLACK,
    env: childEnv(),
  });
  if (r.status !== 0) return failedResult(EXEC_JOB, nonEmptyLines(String(r.stderr || FETCH_FAILED)));
  const raw = String(r.stdout || "");
  const truncated = Buffer.byteLength(raw, "utf8") >= STASH_CAP;
  return verdictFromLines({ kind: EXEC_JOB, lines: pageLines(raw), raw, query: url, cwd, root, truncated });
}
