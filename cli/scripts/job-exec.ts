import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { childEnv } from "../env.ts";
import { SHELL_META } from "./gate-harness.ts";
import { dirOrCwd } from "./job-args.ts";
import { factsResult, fallbackResult, formatFacts, isHtml, squeezLines, verdictFromLines } from "./job-format.ts";
import { resolveStashFile, stashRef } from "./job-stash.ts";
import { endTreeAfterError } from "./job-tree.ts";
import {
  BINARY_STASH,
  BUFFER_SLACK,
  CMD_TIMEOUT_MS,
  EXEC_JOB,
  FACT_WIDTH,
  MAX_FACTS,
  MISSING_STASH,
  NOT_FOUND,
  RTK,
  RTK_SUFFIX,
  STASH_CAP,
} from "./job.constants.ts";
import type { JobResult, SliceOptions, StashRoots } from "./job.types.ts";
import { resolveRoots } from "./workspace-root.ts";

const WHITESPACE = /\s+/;

/** A run's stdout and stderr as text; a run that never started has neither. */
export function outputsOf(run: { stdout?: string | null; stderr?: string | null }): { stdout: string; stderr: string } {
  return { stderr: run.stderr ?? "", stdout: run.stdout ?? "" };
}

/** Runs `file` with `args` in `cwd`, bounded in time and output; ends its tree after a timeout. */
export function runCmd(file: string, args: string[], cwd?: string): SpawnSyncReturns<string> {
  const run = spawnSync(file, args, {
    cwd: dirOrCwd(cwd),
    encoding: "utf8",
    env: childEnv(),
    maxBuffer: STASH_CAP + BUFFER_SLACK,
    timeout: CMD_TIMEOUT_MS,
  });
  endTreeAfterError(run);
  return run;
}

/** Whether a run failed because its binary is not on PATH. */
export function notFound(run: SpawnSyncReturns<string>): boolean {
  const { error } = run;
  return error instanceof Error && "code" in error && error.code === NOT_FOUND;
}

/** The trimmed non-empty lines of `text`. */
export function nonEmptyLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** A failed verdict with these errors and no stash. */
export function failedResult(kind: string, errors: string[]): JobResult {
  return factsResult(formatFacts({ errors, failed: true, kind }));
}

/** Runs `file` through rtk, or bare when rtk is missing or `file` is rtk already. */
function runTool(file: string, args: string[], cwd: string | undefined): SpawnSyncReturns<string> {
  if (file === RTK || file.endsWith(RTK_SUFFIX)) return runCmd(file, args, cwd);
  const viaRtk = runCmd(RTK, [file, ...args], cwd);
  return notFound(viaRtk) ? runCmd(file, args, cwd) : viaRtk;
}

function failedRun(r: SpawnSyncReturns<string>, query: string, { cwd, root }: StashRoots): JobResult {
  const { stdout, stderr } = outputsOf(r);
  const errors = nonEmptyLines(stderr);
  if (errors.length === 0) errors.push(...nonEmptyLines(stdout));
  const raw = [stdout, stderr].filter(Boolean).join("\n");
  const lines = errors.length > 0 ? errors : [`exit ${r.status}`];
  return verdictFromLines({ cwd, errors: lines, kind: EXEC_JOB, lines, query, raw, root });
}

function doneRun(r: SpawnSyncReturns<string>, query: string, { cwd, root }: StashRoots): JobResult {
  const { stdout, stderr } = outputsOf(r);
  const lines = nonEmptyLines(stdout);
  if (lines.length === 0 && stderr.trim() === "") return factsResult(formatFacts({ facts: [], kind: EXEC_JOB, n: 0 }));
  const body = lines.length > 0 ? lines : [stderr.trim()];
  const raw = stdout === "" ? stderr : stdout;
  return verdictFromLines({ cwd, kind: EXEC_JOB, lines: body, query, raw, root });
}

/** Runs one shell-free command line and prints its verdict; shell syntax or html output falls back. */
export function runExec(query: string, { cwd, root }: StashRoots = {}): JobResult {
  const q = query.trim();
  if (SHELL_META.test(q)) return fallbackResult();
  const [file, ...args] = q.split(WHITESPACE).filter(Boolean);
  if (file === undefined) return fallbackResult();
  const r = runTool(file, args, cwd);
  if (notFound(r)) return failedResult(EXEC_JOB, [NOT_FOUND]);
  const { stdout, stderr } = outputsOf(r);
  if (isHtml(stdout, stderr)) return fallbackResult();
  return r.status === 0 ? doneRun(r, q, { cwd, root }) : failedRun(r, q, { cwd, root });
}

/** The text of a stash file, or the error a slice prints for it. */
function readStash(abs: string | null): { text: string } | { error: string } {
  if (abs === null) return { error: MISSING_STASH };
  try {
    const text = fs.readFileSync(abs, "utf8");
    return text.includes("\0") ? { error: BINARY_STASH } : { text };
  } catch {
    return { error: MISSING_STASH };
  }
}

/** A slice bound as a number; NaN when unset. */
function bound(value: SliceOptions["from"]): number {
  return value !== "" && value != null ? Number(value) : NaN;
}

/** The numbered lines of `text` in `from`..`to` that hold `filter`, as facts. */
function pickLines(text: string, { path: filter, from, to }: SliceOptions): string[] {
  const numbered = text.split("\n").map((l, i) => ({ l, n: i + 1 }));
  const a = bound(from);
  const b = bound(to);
  let picked = numbered;
  if (Number.isFinite(a) || Number.isFinite(b)) {
    const start = Number.isFinite(a) ? a : 1;
    const end = Number.isFinite(b) ? b : numbered.length;
    picked = numbered.filter((x) => x.n >= start && x.n <= end);
  }
  if (filter !== undefined && filter !== "") picked = picked.filter((x) => x.l.includes(filter));
  return picked.map((x) => `stash:${x.n} — ${x.l.trim().slice(0, FACT_WIDTH)}`);
}

/** Prints the lines of a stash a range and a filter pick; past `MAX_FACTS` it names the stash again. */
export function runSlice({
  stash,
  path: filter,
  from,
  to,
  cwd = process.cwd(),
  root = resolveRoots({}, { cwd }).root,
}: SliceOptions = {}): JobResult {
  const abs = resolveStashFile({ cwd, root }, stash);
  const read = readStash(abs);
  if ("error" in read) return failedResult(EXEC_JOB, [read.error]);
  const factLines = pickLines(read.text, { from, path: filter, to });
  const n = factLines.length;
  if (n <= MAX_FACTS) return factsResult(formatFacts({ facts: factLines, kind: EXEC_JOB, n }));
  const ref = stashRef({ cwd, root }, path.basename(String(abs)));
  return factsResult(formatFacts({ facts: squeezLines(factLines, filter), kind: EXEC_JOB, n, stash: ref }));
}
