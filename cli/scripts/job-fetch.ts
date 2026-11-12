import { spawnSync } from "node:child_process";

import { childEnv } from "../env.ts";
import { dirOrCwd } from "./job-args.ts";
import { failedResult, nonEmptyLines, outputsOf } from "./job-exec.ts";
import { fallbackResult, verdictFromLines } from "./job-format.ts";
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
import type { FetchOptions, JobResult } from "./job.types.ts";

const TITLE = /<title[^>]*>(?<title>[\s\S]*?)<\/title>/i;
const SCRIPTS = /<script[\s\S]*?<\/script>/gi;
const STYLES = /<style[\s\S]*?<\/style>/gi;
const TAGS = /<[^>]+>/g;
const SPACES = /\s+/g;

/** The space after a full stop, where the page text breaks into lines. */
const SENTENCE_BREAK = /(?<=\.)\s+/;

/** A page's title and its visible text. */
export type PageText = { title: string; text: string };

/** A page's title and its visible text on one line. */
export function stripHtml(html: string | undefined): PageText {
  const s = html ?? "";
  const title = TITLE.exec(s)?.groups?.title ?? "";

  const text = s
    .replaceAll(SCRIPTS, " ")
    .replaceAll(STYLES, " ")
    .replaceAll(TAGS, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll(SPACES, " ")
    .trim();

  return { text, title: title.replaceAll(SPACES, " ").trim() };
}

/** The page's title, then its text one sentence a line. */
function pageLines(raw: string): string[] {
  const { title, text } = stripHtml(raw);
  const lines: string[] = [];

  if (title !== "") lines.push(title);

  for (const part of text.split(SENTENCE_BREAK)) {
    const p = part.trim();

    if (p !== "") lines.push(p.slice(0, LINE_WIDTH));
  }

  return lines.length > 0 ? lines : [EMPTY_PAGE];
}

/** Fetches an http url in a child and prints the page as text facts; any other query falls back. */
export function runFetch(query: string, { cwd, root, timeoutMs = FETCH_TIMEOUT_MS }: FetchOptions = {}): JobResult {
  const url = query.trim();

  if (!HTTP_URL.test(url)) return fallbackResult();

  const r = spawnSync(process.execPath, ["-e", FETCH_SCRIPT, url], {
    cwd: dirOrCwd(cwd),
    encoding: "utf8",
    env: childEnv(),
    maxBuffer: STASH_CAP + BUFFER_SLACK,
    timeout: timeoutMs,
  });

  const { stdout: raw, stderr } = outputsOf(r);

  if (r.status !== 0) return failedResult(EXEC_JOB, nonEmptyLines(stderr === "" ? FETCH_FAILED : stderr));
  const isTruncated = Buffer.byteLength(raw, "utf8") >= STASH_CAP;
  const lines = pageLines(raw);

  return verdictFromLines({ cwd, kind: EXEC_JOB, lines, query: url, raw, root, truncated: isTruncated });
}
