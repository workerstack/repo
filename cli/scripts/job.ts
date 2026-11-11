#!/usr/bin/env bun
import { parseArgv, resolveJobCwd } from "./job-args.ts";
import { runExec, runSlice } from "./job-exec.ts";
import { runFetch } from "./job-fetch.ts";
import { fallbackResult, shouldFallback } from "./job-format.ts";
import { runSearch } from "./job-search.ts";
import { FALLBACK, FALLBACK_EXIT, FETCH_JOB, SEARCH_JOB, SLICE_JOB } from "./job.constants.ts";
import type { JobOptions, JobResult, ParsedArgs } from "./job.types.ts";
/** Deterministic repo for job: search|exec|test|slice|fetch. Exit 2 + FALLBACK on denylist/HTML-as-exec/unbounded. */
import { resolveRoots } from "./workspace-root.ts";

/** Runs one job from its options; an unknown flag, job or refused query falls back. */
export function runJob({
  job,
  query,
  cwd,
  root,
  path: searchPath,
  glob,
  stash,
  from,
  to,
  unknown,
}: JobOptions = {}): JobResult {
  if (unknown || shouldFallback(job, query, { stash })) return fallbackResult();
  const at = cwd || process.cwd();
  const stashRoot = root || resolveRoots({}, { cwd: at }).root;
  // shouldFallback passed, so a search, fetch or exec job has a non-empty query.
  const q = String(query);
  if (job === SEARCH_JOB) return runSearch(q, { cwd: at, glob, path: searchPath, root: stashRoot });
  if (job === SLICE_JOB) return runSlice({ cwd: at, from, path: searchPath, root: stashRoot, stash, to });
  if (job === FETCH_JOB) return runFetch(q, { cwd: at, root: stashRoot });
  return runExec(q, { cwd: at, root: stashRoot });
}

/** The job options of a parsed command line run in `cwd`. */
function optionsOf(parsed: ParsedArgs, cwd: string, root: string): JobOptions {
  const { job, query, path, glob, stash, from, to } = parsed;
  return { cwd, from, glob, job, path, query, root, stash, to };
}

function fallbackExit(): number {
  process.stdout.write(`${FALLBACK}\n`);
  return FALLBACK_EXIT;
}

/** `repo job`: prints the verdict of one job and exits with its code; FALLBACK and 2 on anything it cannot run. */
export function main(argv: string[]): number {
  try {
    const parsed = parseArgv(argv);
    if (parsed.unknown) return fallbackExit();
    const roots = resolveRoots();
    const cwd = parsed.cwd ? resolveJobCwd(parsed.cwd, roots.cwd) : roots.cwd;
    if (!cwd) return fallbackExit();
    const result = runJob(optionsOf(parsed, cwd, roots.root));
    process.stdout.write(result.text);
    return result.code;
  } catch {
    return fallbackExit();
  }
}
