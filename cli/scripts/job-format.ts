import {
  COMMAND_FAILED,
  DENY_GIT,
  DENY_QUERY,
  DENY_SEGS,
  END_SCORE,
  FAIL_RE,
  FAIL_SCORE,
  FALLBACK,
  FALLBACK_EXIT,
  FETCH_JOB,
  HTML_RES,
  HTTP_URL,
  JOBS,
  LINE_UNITS,
  MATCH_UNITS,
  MAX_ERRORS,
  MAX_FACTS,
  MAX_STDOUT,
  MAX_TEXT_LINES,
  NO_MATCHES,
  NO_OUTPUT,
  PASS_RE,
  PASS_SCORE,
  PLAIN_SCORE,
  QUERY_SCORE,
  SEARCH_FAILED,
  SEARCH_JOB,
  SLICE_JOB,
  STACK_RE,
} from "./job.constants.ts";
import { writeStash } from "./job-stash.ts";
import type {
  FactsInput,
  JobResult,
  Picking,
  RankContext,
  RankedItem,
  SqueezeItem,
  VerdictInput,
} from "./job.types.ts";

/** `s` with every regex metacharacter escaped. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The result that tells the caller to run the plain command. */
export function fallbackResult(): JobResult {
  return { fallback: true, text: FALLBACK + "\n", code: FALLBACK_EXIT };
}

/** A verdict printed as `text`, exit 0. */
export function factsResult(text: string): JobResult {
  return { fallback: false, text, code: 0 };
}

/** Whether an exec or search query names something a job refuses. */
function deniedQuery(q: string): boolean {
  if (DENY_QUERY.some((re) => re.test(q))) return true;
  if (DENY_GIT.test(q.replace(/\\/g, "/"))) return true;
  return DENY_SEGS.some((seg) => new RegExp(`(^|[\\/\\s'"\`])${escapeRe(seg)}([\\/\\s'"\`]|$)`).test(q));
}

/** Whether a job must fall back: an unknown job, a slice without a stash, a non-http fetch or a refused query. */
export function shouldFallback(job: unknown, query: unknown, extra: { stash?: string | undefined } = {}): boolean {
  const j = String(job || "")
    .trim()
    .toLowerCase();
  if (!JOBS.has(j)) return true;
  if (j === SLICE_JOB) return !String(extra.stash || "").trim();
  if (j === FETCH_JOB) return !HTTP_URL.test(String(query || "").trim());
  const q = String(query || "");
  return !q.trim() || deniedQuery(q);
}

/** Whether stdout or stderr holds an html page. */
export function isHtml(stdout: unknown, stderr: unknown): boolean {
  const s = String(stdout || "") + String(stderr || "");
  return HTML_RES.some((re) => re.test(s));
}

/** Whether output is html or past `MAX_STDOUT`. */
export function looksHtmlOrUnbounded(stdout: unknown, stderr: unknown): boolean {
  return String(stdout || "").length + String(stderr || "").length > MAX_STDOUT || isHtml(stdout, stderr);
}

function queryPattern(q: string): RegExp | null {
  if (!q) return null;
  try {
    return new RegExp(q);
  } catch {
    return null;
  }
}

function matchesQuery(s: string, ctx: RankContext): boolean {
  return ctx.queryRe ? ctx.queryRe.test(s) : Boolean(ctx.q) && s.includes(ctx.q);
}

function scoreOf(item: SqueezeItem, ctx: RankContext): number {
  const s = item.l;
  if (FAIL_RE.test(s) || STACK_RE.test(s)) return FAIL_SCORE;
  if (matchesQuery(s, ctx)) return QUERY_SCORE;
  if (item.i === 0 || item.i === ctx.last) return END_SCORE;
  return PASS_RE.test(s) ? PASS_SCORE : PLAIN_SCORE;
}

/** Keeps, in order, the ranked lines `pred` takes until `MAX_FACTS` are kept. */
function take(pick: Picking, pred: (x: RankedItem) => boolean): void {
  for (const x of pick.ranked) {
    if (pick.kept.length >= MAX_FACTS) break;
    if (pick.used.has(x.i) || !pred(x)) continue;
    pick.kept.push(x);
    pick.used.add(x.i);
  }
}

/** At most `MAX_FACTS` lines, in order: failures, query hits, the first and last, then the rest, passes last. */
export function squeezLines(lines: unknown[] | null | undefined, query: unknown): string[] {
  const arr: SqueezeItem[] = (lines || []).map((l, i) => ({ l: String(l), i }));
  if (arr.length <= MAX_FACTS) return arr.map((x) => x.l);
  const q = String(query || "").trim();
  const ctx: RankContext = { queryRe: queryPattern(q), q, last: arr.length - 1 };
  const pick: Picking = { ranked: arr.map((x) => ({ ...x, sc: scoreOf(x, ctx) })), kept: [], used: new Set() };
  take(pick, (x) => x.sc >= FAIL_SCORE);
  take(pick, (x) => x.sc >= QUERY_SCORE);
  take(pick, (x) => x.i === 0);
  take(pick, (x) => x.i === ctx.last);
  take(pick, (x) => x.sc > PASS_SCORE);
  take(pick, () => true);
  pick.kept.sort((a, b) => a.i - b.i);
  return pick.kept.map((x) => x.l);
}

function block(lines: string[]): string {
  return lines.slice(0, MAX_TEXT_LINES).join("\n") + "\n";
}

function failedText({ kind, errors, stash }: FactsInput): string {
  const head = kind === SEARCH_JOB ? SEARCH_FAILED : COMMAND_FAILED;
  const errorLines = (errors || []).slice(0, MAX_ERRORS).map((e) => `- ${e}`);
  return block([stash ? `${head} stash=${stash}` : head, ...errorLines]);
}

function countedText({ kind, stash, truncated }: FactsInput, n: number, shown: string[]): string {
  const [one, many] = kind === SEARCH_JOB ? MATCH_UNITS : LINE_UNITS;
  const unit = n === 1 ? one : many;
  const nLabel = truncated ? `${n}+` : String(n);
  const head = stash ? `${nLabel} ${unit}, ${shown.length} shown. stash=${stash}` : `${n} ${unit}.`;
  return block([head, ...shown.map((f) => `- ${f}`)]);
}

/** The short verdict of one job: a failure with its errors, no output, or a count with the facts shown. */
export function formatFacts(input: FactsInput = {}): string {
  const { n } = input;
  const shown = (input.facts || []).slice(0, MAX_FACTS);
  if (input.failed) return failedText(input);
  if (!n) return `${input.kind === SEARCH_JOB ? NO_MATCHES : NO_OUTPUT}\n`;
  return countedText(input, n, shown);
}

/** The verdict of a job's lines, stashing all of them when there are more than it shows. */
export function verdictFromLines({
  kind,
  lines,
  raw,
  query,
  cwd,
  root,
  errors,
  truncated = false,
}: VerdictInput): JobResult {
  const n = lines.length;
  const facts = squeezLines(lines, query);
  const stash =
    n > MAX_FACTS || Buffer.byteLength(raw, "utf8") > MAX_STDOUT ? writeStash({ cwd, root }, kind, raw) : "";
  if (errors)
    return factsResult(formatFacts({ kind, failed: true, errors: errors.slice(0, MAX_ERRORS), stash, n, facts }));
  return factsResult(formatFacts({ kind, n, facts, stash, truncated }));
}
