import { writeStash } from "./job-stash.ts";
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
import type {
  FactsInput,
  JobResult,
  Picking,
  RankContext,
  RankedItem,
  SqueezeItem,
  VerdictInput,
} from "./job.types.ts";

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

/** `s` with every regex metacharacter escaped. */
export function escapeRe(s: string): string {
  return s.replaceAll(REGEX_META, "\\$&");
}

/** The result that tells the caller to run the plain command. */
export function fallbackResult(): JobResult {
  return { code: FALLBACK_EXIT, fallback: true, text: `${FALLBACK}\n` };
}

/** A verdict printed as `text`, exit 0. */
export function factsResult(text: string): JobResult {
  return { code: 0, fallback: false, text };
}

/** Whether an exec or search query names something a job refuses. */
function deniedQuery(q: string): boolean {
  if (DENY_QUERY.some((re) => re.test(q))) return true;

  if (DENY_GIT.test(q.replaceAll("\\", "/"))) return true;

  return DENY_SEGS.some((seg) => new RegExp(`(^|[\\/\\s'"\`])${escapeRe(seg)}([\\/\\s'"\`]|$)`).test(q));
}

/** Whether a job must fall back: an unknown job, a slice without a stash, a non-http fetch or a refused query. */
export function shouldFallback(
  job: string | undefined,
  query: string | undefined,
  extra: { stash?: string | undefined } = {},
): boolean {
  const j = (job ?? "").trim().toLowerCase();

  if (!JOBS.has(j)) return true;

  if (j === SLICE_JOB) return (extra.stash ?? "").trim() === "";
  const q = query ?? "";

  if (j === FETCH_JOB) return !HTTP_URL.test(q.trim());

  return q.trim() === "" || deniedQuery(q);
}

/** Whether stdout or stderr holds an html page. */
export function isHtml(stdout: string | undefined, stderr: string | undefined): boolean {
  const s = (stdout ?? "") + (stderr ?? "");

  return HTML_RES.some((re) => re.test(s));
}

/** Whether output is html or past `MAX_STDOUT`. */
export function looksHtmlOrUnbounded(stdout: string | undefined, stderr: string | undefined): boolean {
  return (stdout ?? "").length + (stderr ?? "").length > MAX_STDOUT || isHtml(stdout, stderr);
}

function queryPattern(q: string): RegExp | null {
  if (q === "") return null;

  try {
    return new RegExp(q);
  } catch {
    return null;
  }
}

function matchesQuery(s: string, ctx: RankContext): boolean {
  return ctx.queryRe === null ? ctx.q !== "" && s.includes(ctx.q) : ctx.queryRe.test(s);
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
export function squeezLines(lines: unknown[] | null | undefined, query: string | undefined): string[] {
  const arr: SqueezeItem[] = (lines ?? []).map((l, i) => ({ i, l: String(l) }));

  if (arr.length <= MAX_FACTS) return arr.map((x) => x.l);
  const q = (query ?? "").trim();
  const ctx: RankContext = { last: arr.length - 1, q, queryRe: queryPattern(q) };
  const pick: Picking = { kept: [], ranked: arr.map((x) => ({ ...x, sc: scoreOf(x, ctx) })), used: new Set() };
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
  return `${lines.slice(0, MAX_TEXT_LINES).join("\n")}\n`;
}

function failedText({ kind, errors, stash }: FactsInput): string {
  const head = kind === SEARCH_JOB ? SEARCH_FAILED : COMMAND_FAILED;
  const errorLines = (errors ?? []).slice(0, MAX_ERRORS).map((e) => `- ${e}`);

  return block([(stash ?? "") === "" ? head : `${head} stash=${stash}`, ...errorLines]);
}

function countedText({ kind, stash, truncated }: FactsInput, n: number, shown: string[]): string {
  const [one, many] = kind === SEARCH_JOB ? MATCH_UNITS : LINE_UNITS;
  const unit = n === 1 ? one : many;
  const nLabel = truncated === true ? `${n}+` : String(n);
  const head = (stash ?? "") === "" ? `${n} ${unit}.` : `${nLabel} ${unit}, ${shown.length} shown. stash=${stash}`;

  return block([head, ...shown.map((f) => `- ${f}`)]);
}

/** The short verdict of one job: a failure with its errors, no output, or a count with the facts shown. */
export function formatFacts(input: FactsInput = {}): string {
  const { n } = input;
  const shown = (input.facts ?? []).slice(0, MAX_FACTS);

  if (input.failed === true) return failedText(input);

  if (n === undefined || n === 0) return `${input.kind === SEARCH_JOB ? NO_MATCHES : NO_OUTPUT}\n`;

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

  if (errors !== undefined)
    return factsResult(formatFacts({ errors: errors.slice(0, MAX_ERRORS), facts, failed: true, kind, n, stash }));

  return factsResult(formatFacts({ facts, kind, n, stash, truncated }));
}
