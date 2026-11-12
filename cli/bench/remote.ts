/**
 * `repo bench --remote`'s CI half: the preconditions a dispatch needs, then dispatching bench.yml at HEAD, waiting on
 * the run, and reading each OS's raw result from its artifacts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { newestFirst, readJson } from "../scripts/ci-wait-poll.ts";
import type { Runner } from "../scripts/ci-wait-run.ts";
import { BENCH_PATH } from "../sync/bench-workflow.constants.ts";
import {
  CONCLUSION_SKIPPED,
  CONCLUSION_SUCCESS,
  DEFAULT_BRANCH,
  DISPATCH_EVENT,
  FIND_BOUND_MS,
  FIND_MINUTES,
  JOB_OS,
  ORIGIN_PREFIX,
  POLL_MS,
  RUN_COMPLETED,
  SHA_SHOWN,
  WAIT_BOUND_MS,
  WAIT_MINUTES,
  WORKFLOW,
} from "./bench.constants.ts";
import type { BenchResult } from "./score.ts";

/** git and gh in the repo root, the clock and sleep the waits run on, and where a progress line is printed. */
export type RemoteIo = {
  cwd: string;
  git: Runner;
  gh: Runner;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  say: (line: string) => void;
};
/** What a dispatch measures: the spec, the OSes, and HEAD's sha and branch. */
export type Target = { spec: string; os: readonly string[]; sha: string; branch: string };
/** Each OS's result in the target's order, or the line saying why there is none. */
export type Remote = { ok: true; results: BenchResult[] } | { ok: false; line: string };

const DIRTY = "--remote measures HEAD; commit or drop the changes first";
/** Job conclusions that are not a failure. */
const PASSED: readonly string[] = [CONCLUSION_SUCCESS, CONCLUSION_SKIPPED];

function noWorkflow() {
  return [
    `--remote needs ${BENCH_PATH};`,
    'add "benchmark" to packs in workerstack.config.ts and run bun repo sync',
  ].join(" ");
}

function runsSchema() {
  const run = z.object({ createdAt: z.string(), databaseId: z.number(), event: z.string(), headSha: z.string() });
  return z.array(run.extend({ url: z.string() }));
}
type Listed = z.infer<ReturnType<typeof runsSchema>>[number];

function viewSchema() {
  const job = z.object({ conclusion: z.string(), name: z.string() });
  return z.object({ conclusion: z.string(), jobs: z.array(job), status: z.string() });
}
type View = z.infer<ReturnType<typeof viewSchema>>;

function resultSchema() {
  const env = z.object({ arch: z.string(), bun: z.string(), cores: z.number(), cpu: z.string(), dirty: z.boolean() });
  const machine = env.extend({
    label: z.string(),
    memoryBytes: z.number(),
    platform: z.string(),
    // An artifact from before the floor was recorded has none.
    rssFloorBytes: z.number().nullable().default(null),
    sha: z.string(),
  });
  const metric = z.object({
    better: z.enum(["lower", "higher"]),
    name: z.string(),
    unit: z.string(),
    weight: z.number(),
  });
  const candidate = z.object({ name: z.string(), samples: z.record(z.string(), z.array(z.number())) });
  const counts = { runs: z.number(), spec: z.string(), warmup: z.number() };
  return z.object({ ...counts, candidates: z.array(candidate), env: machine, metrics: z.array(metric) });
}

function text(io: RemoteIo, args: string[]) {
  return io.git(args, io.cwd).stdout.trim();
}

/** The target to dispatch, or the line naming the first precondition that is not met. */
export function remoteTarget(io: RemoteIo, spec: string, others: readonly string[]): Target | string {
  if (others.length === 0) return `${spec}'s os names no runner but this one; add one or run without --remote`;
  if (!fs.existsSync(path.join(io.cwd, BENCH_PATH))) return noWorkflow();
  const named = text(io, ["rev-parse", "--abbrev-ref", "origin/HEAD"]).replace(ORIGIN_PREFIX, "");
  const base = named === "" ? DEFAULT_BRANCH : named;
  if (io.git(["cat-file", "-e", `origin/${base}:${BENCH_PATH}`], io.cwd).code !== 0)
    return `GitHub dispatches ${WORKFLOW} only from origin/${base}; land it there first (bun repo push)`;
  const sha = text(io, ["rev-parse", "HEAD"]);
  const branch = text(io, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (text(io, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]) !== sha)
    return `origin does not have HEAD ${sha.slice(0, SHA_SHOWN)}; run bun repo push first`;
  if (text(io, ["status", "--porcelain"]) !== "") return DIRTY;
  return { branch, os: others, sha, spec };
}

/** The dispatched bench.yml runs at the target's sha. */
function dispatched(io: RemoteIo, target: Target): Listed[] {
  const fields = "createdAt,databaseId,event,headSha,url";
  const args = ["run", "list", "--workflow", WORKFLOW, "--commit", target.sha, "--event", DISPATCH_EVENT];
  const runs = readJson(io.gh([...args, "--json", fields], io.cwd), runsSchema()) ?? [];
  return newestFirst(runs.filter((run) => run.headSha === target.sha && run.event === DISPATCH_EVENT));
}

/** The runs listed before the dispatch, and when the look for the new one began. */
type Finding = { known: ReadonlySet<number>; started: number };

/** The newest dispatched run at the sha that was not there before, looked for until `FIND_BOUND_MS`. */
async function findRun(io: RemoteIo, target: Target, finding: Finding): Promise<Listed | null> {
  const fresh = dispatched(io, target).find((run) => !finding.known.has(run.databaseId));
  if (fresh !== undefined) return fresh;
  if (io.now() - finding.started >= FIND_BOUND_MS) return null;
  await io.sleep(POLL_MS);
  return findRun(io, target, finding);
}

/** The run's view once it completes, or null when it is still running at `WAIT_BOUND_MS`. */
async function completed(io: RemoteIo, run: Listed, started: number): Promise<View | null> {
  const got = io.gh(["run", "view", String(run.databaseId), "--json", "conclusion,jobs,status"], io.cwd);
  const view = readJson(got, viewSchema());
  if (view?.status === RUN_COMPLETED) return view;
  if (io.now() - started >= WAIT_BOUND_MS) return null;
  await io.sleep(POLL_MS);
  return completed(io, run, started);
}

/** The OS of each job that did not pass (`bench (windows-latest)` → `windows-latest`), or the run's conclusion. */
function failedOs(view: View) {
  const failed = view.jobs.filter((job) => !PASSED.includes(job.conclusion));
  return failed.length > 0 ? failed.map((job) => job.name.replace(JOB_OS, "$1")).join(", ") : view.conclusion;
}

function readRaw(file: string): BenchResult | null {
  try {
    return resultSchema().parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** Downloads the run's artifacts and reads each OS's raw result, or the line naming the first that is missing. */
function download(io: RemoteIo, run: Listed, target: Target): Remote {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-bench-"));
  try {
    io.gh(["run", "download", String(run.databaseId), "--dir", dir], io.cwd);
    const results: BenchResult[] = [];
    for (const label of target.os) {
      const raw = readRaw(path.join(dir, `bench-${target.spec}-${label}`, `${label}.json`));
      if (raw === null)
        return { line: `run ${run.databaseId} left no bench result for ${label}; see ${run.url}`, ok: false };
      results.push(raw);
    }
    return { ok: true, results };
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

/** Dispatches bench.yml for the target, says where it runs, waits on it and reads each OS's result. */
export async function runRemote(io: RemoteIo, target: Target): Promise<Remote> {
  const known = new Set(dispatched(io, target).map((run) => run.databaseId));
  const inputs = [`spec=${target.spec}`, `os=${JSON.stringify(target.os)}`, `sha=${target.sha}`];
  const sent = io.gh(
    ["workflow", "run", WORKFLOW, "--ref", target.branch, ...inputs.flatMap((f) => ["-f", f])],
    io.cwd,
  );
  const short = target.sha.slice(0, SHA_SHOWN);
  if (sent.code !== 0) return { line: `gh could not dispatch ${WORKFLOW}: ${sent.stderr.trim()}`, ok: false };
  const run = await findRun(io, target, { known, started: io.now() });
  if (run === null) return { line: `no ${WORKFLOW} run at ${short} showed up in ${FIND_MINUTES} min`, ok: false };
  const id = run.databaseId;
  io.say(`dispatched ${WORKFLOW} at ${short} for ${target.os.join(", ")}: ${run.url}`);
  const view = await completed(io, run, io.now());
  if (view === null) return { line: `run ${id} still running after ${WAIT_MINUTES} min; see ${run.url}`, ok: false };
  if (view.conclusion !== CONCLUSION_SUCCESS)
    return { line: `run ${id} failed (${failedOs(view)}); see ${run.url}`, ok: false };
  return download(io, run, target);
}
