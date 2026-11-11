import type { SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { dirOrCwd, resolveUnder } from "./job-args.ts";
import { failedResult, nonEmptyLines, notFound, outputsOf, runCmd } from "./job-exec.ts";
import { escapeRe, fallbackResult, formatFacts, factsResult, isHtml, verdictFromLines } from "./job-format.ts";
import {
  FACT_WIDTH,
  GLOBSTAR_DIR,
  LINE_WIDTH,
  MAX_HITS,
  RG,
  RG_ARGS,
  RG_NO_MATCH,
  SEARCH_JOB,
  SEARCH_MAX_FILE,
  SEARCH_SKIP_DIRS,
  STASH_CAP,
} from "./job.constants.ts";
import type { JobResult, SearchHits, SearchOptions, SearchScope, SearchState } from "./job.types.ts";

/** One rg hit line: `file:line:text`. */
const RG_HIT = /^(?<file>[^:]+):(?<line>\d+):(?<text>.*)$/;

/** A glob as a whole-path pattern: `**` crosses dirs, `*` and `?` stay in one. */
export function globToRegExp(glob: string | undefined): RegExp {
  const g = (glob ?? "").replaceAll("\\", "/");
  let s = "";
  for (let i = 0; i < g.length; i++) {
    const c = g.charAt(i);
    if (g.startsWith(GLOBSTAR_DIR, i)) {
      s += "(?:.*/)?";
      i += GLOBSTAR_DIR.length - 1;
    } else if (g.startsWith("**", i)) {
      s += ".*";
      i += 1;
    } else if (c === "*") {
      s += "[^/]*";
    } else if (c === "?") {
      s += "[^/]";
    } else {
      s += escapeRe(c);
    }
  }
  return new RegExp(`^${s}$`);
}

/** Whether `rel` matches `pattern`; a pattern with no slash matches at any depth. */
export function globMatch(rel: string | undefined, pattern: string): boolean {
  const n = (rel ?? "").replaceAll("\\", "/");
  const raw = pattern.replaceAll("\\", "/");
  if (raw === "") return false;
  const p = raw.includes("/") ? raw : `**/${raw}`;
  return globToRegExp(p).test(n) || globToRegExp(raw).test(n);
}

function fileMatchesGlobs(rel: string, globs: string[]): boolean {
  if (globs.length === 0) return true;
  const base = path.posix.basename(rel);
  return globs.some((g) => globMatch(rel, g) || globMatch(base, g));
}

function full(st: SearchState): boolean {
  return st.n >= MAX_HITS || st.bytes >= STASH_CAP;
}

/** The text of a searchable file under the globs, or null. */
function searchable(st: SearchState, abs: string, rel: string): string | null {
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > SEARCH_MAX_FILE || !fileMatchesGlobs(rel, st.glob)) return null;
    const text = fs.readFileSync(abs, "utf8");
    return text.includes("\0") ? null : text;
  } catch {
    return null;
  }
}

// Callers check the limits before each file, so a file starts with room left.
function searchFile(st: SearchState, abs: string): void {
  const rel = path.relative(st.cwd, abs).replaceAll("\\", "/");
  const text = searchable(st, abs, rel);
  if (text === null) return;
  const lines = text.split("\n");
  for (const [i, line] of lines.entries()) {
    if (!(st.re === null ? line.includes(st.query) : st.re.test(line))) continue;
    st.n += 1;
    const fact = `${rel}:${i + 1} — ${line.trim().slice(0, FACT_WIDTH)}`;
    st.facts.push(fact);
    st.bytes += Buffer.byteLength(fact, "utf8") + 1;
    if (full(st)) return;
  }
}

function walk(st: SearchState, dir: string): void {
  let ents: fs.Dirent[];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    if (full(st)) return;
    if (SEARCH_SKIP_DIRS.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(st, abs);
    else if (ent.isFile()) searchFile(st, abs);
  }
}

function patternOf(query: string): RegExp | null {
  try {
    return new RegExp(query);
  } catch {
    return null;
  }
}

/** The search rg would do, in node: for a machine with no rg. */
function nodeSearch(query: string, scope: SearchScope): SearchHits {
  const st: SearchState = { ...scope, bytes: 0, facts: [], n: 0, query, re: patternOf(query) };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(scope.start);
  } catch {
    return { facts: [], n: 0, truncated: false };
  }
  if (stat.isFile()) searchFile(st, scope.start);
  else walk(st, scope.start);
  return { facts: st.facts, n: st.n, truncated: full(st) };
}

/** rg's `file:line:text` hits as facts. */
function parseSearchHits(stdout: string): { facts: string[]; raw: string } {
  const hits = nonEmptyLines(stdout);
  const facts = hits.map((line) => {
    const m = RG_HIT.exec(line);
    if (m === null) return line.slice(0, LINE_WIDTH);
    const g = m.groups;
    return `${String(g?.file)}:${String(g?.line)} — ${String(g?.text).trim().slice(0, FACT_WIDTH)}`;
  });
  return { facts, raw: hits.join("\n") };
}

/** The verdict of an rg run, or null when it ended without a status (killed) and node searches instead. */
function rgVerdict(r: SpawnSyncReturns<string>, query: string, opts: SearchOptions): JobResult | null {
  const { stdout, stderr } = outputsOf(r);
  if (isHtml(stdout, stderr)) return fallbackResult();
  if (r.status === RG_NO_MATCH) return factsResult(formatFacts({ facts: [], kind: SEARCH_JOB, n: 0 }));
  if (r.status === 0) {
    const { facts, raw } = parseSearchHits(stdout);
    const isTruncated = facts.length >= MAX_HITS;
    const { cwd, root } = opts;
    return verdictFromLines({ cwd, kind: SEARCH_JOB, lines: facts, query, raw, root, truncated: isTruncated });
  }
  if (r.status == null) return null;
  const errors = nonEmptyLines(stderr);
  return failedResult(SEARCH_JOB, errors.length > 0 ? errors : [`rg exit ${r.status}`]);
}

function globList(glob: SearchOptions["glob"]): string[] {
  if (Array.isArray(glob)) return glob.filter(Boolean);
  return glob === undefined || glob === "" ? [] : [glob];
}

/** Searches with rg under the cwd (node when rg is missing); a path that leaves the cwd falls back. */
export function runSearch(query: string, { cwd, root, path: searchPath, glob }: SearchOptions = {}): JobResult {
  const base = dirOrCwd(cwd);
  const start = searchPath === undefined || searchPath === "" ? base : resolveUnder(base, searchPath);
  if (start === null) return fallbackResult();
  const globs = globList(glob);
  const rel = path.relative(base, start);
  const rgArgs = [...RG_ARGS, ...globs.flatMap((g) => ["-g", g]), "-e", query, rel === "" ? "." : rel];
  const r = runCmd(RG, rgArgs, base);
  const verdict = notFound(r) ? null : rgVerdict(r, query, { cwd: base, root });
  if (verdict !== null) return verdict;
  const node = nodeSearch(query, { cwd: base, glob: globs, start });
  const { facts, truncated } = node;
  return verdictFromLines({ cwd: base, kind: SEARCH_JOB, lines: facts, query, raw: facts.join("\n"), root, truncated });
}
