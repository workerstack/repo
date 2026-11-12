/**
 * `repo ci wait [<branch>]`: finds the newest `ci` run for the tip of the branch (default HEAD), waits for it, and
 * exits 0 when it passed, 1 when it failed (with the failed jobs and their logs), 2 when a newer run on the branch
 * superseded it, 3 when there is no run and ci does not run on the branch, 4 on an error. Each outcome is recorded by
 * sha.
 */
import { z } from "zod";

import { finish, newestFirst, ghJson, type RunInfo, type RunOutcome } from "./ci-wait-poll.ts";
import { recordRoot, writeRecord, type RecordFs } from "./ci-wait-record.ts";
import { realSleep, spawnRunner, type Runner } from "./ci-wait-run.ts";
import {
  EXIT_ERROR,
  EXIT_FAILED,
  EXIT_NOTHING,
  EXIT_PASSED,
  EXIT_SUPERSEDED,
  GH_AUTH,
  GH_LIST_COMMIT,
  GH_OPEN_PRS,
  GIT_BRANCH,
  GIT_DEFAULT_BRANCH,
  GIT_REMOTE_TIP,
  GIT_REMOTES,
  GIT_REV,
  GIVE_UP_MS,
  HEAD_REF,
  MS_PER_SECOND,
  POLL_MS,
  REMOTE_PREFIX,
  SHA_SHOWN,
} from "./ci-wait.constants.ts";

export { ghJson } from "./ci-wait-poll.ts";

export type { Runner } from "./ci-wait-run.ts";

export type WaitDeps = {
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Milliseconds; the clock the wait is measured on. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  git?: Runner;
  gh?: Runner;
  /** Where the outcome record is written; node's fs when omitted. */
  fs?: RecordFs | undefined;
  /** The branch whose tip is waited on; HEAD and its branch when omitted. */
  branch?: string | undefined;
  /** The commit and branch to wait on; skips the HEAD, branch and remote checks and keeps the gh login check. */
  target?: Target;
};

/** How the wait for HEAD's run ended: `error` carries the line `repo ci wait` prints and a shorter `detail`. */
export type WaitOutcome = RunOutcome | { kind: "nothing"; line: string };

type Ended = WaitOutcome;

type Io = Required<Omit<WaitDeps, "target" | "branch" | "fs">> & { fs?: RecordFs | undefined };

/** A commit and the branch whose `ci` run for it is waited on. */
export type Target = { sha: string; branch: string };

function runsSchema() {
  return z.array(z.object({ createdAt: z.string(), databaseId: z.number(), headBranch: z.string() }));
}

function prsSchema() {
  return z.array(z.object({ number: z.number() }));
}

const GH_LOGIN = "gh is not installed or not logged in; run `gh auth login`";

/** The commit of `branch` on origin, as last fetched, and the branch; or why it cannot be waited on. */
function remoteTip(io: Io, branch: string): Target | { error: string } {
  const tip = io.git(GIT_REMOTE_TIP(branch), io.cwd).stdout.trim();

  if (tip === "") return { error: `${branch} is not on origin; push it first` };

  return io.gh(GH_AUTH.slice(), io.cwd).code === 0 ? { branch, sha: tip } : { error: GH_LOGIN };
}

/** HEAD and its branch, or why there is nothing to wait on. */
function headTip(io: Io): Target | { error: string } {
  const head = io.git(GIT_REV(HEAD_REF), io.cwd);
  const sha = head.stdout.trim();

  if (head.code !== 0 || sha === "")
    return { error: `cannot read ${HEAD_REF} (${head.stderr.trim()}); run it inside a git checkout` };

  if (io.git(GIT_REMOTES(sha), io.cwd).stdout.trim() === "")
    return { error: `${sha.slice(0, SHA_SHOWN)} is not on any remote branch; push it first` };

  if (io.gh(GH_AUTH.slice(), io.cwd).code !== 0) return { error: GH_LOGIN };

  return { branch: io.git(GIT_BRANCH.slice(), io.cwd).stdout.trim(), sha };
}

/** The tip of the given branch on origin, or of HEAD when none is given. */
function locate(io: Io, given: string | undefined): Target | { error: string } {
  return given === undefined ? headTip(io) : remoteTip(io, given);
}

/** The given target once gh is logged in, or why there is nothing to wait on. */
function givenTarget(io: Io, target: Target): Target | { error: string } {
  return io.gh(GH_AUTH.slice(), io.cwd).code === 0 ? target : { error: GH_LOGIN };
}

/** The line that says ci has no run to wait on for the branch, or null when ci runs on it or that cannot be told. */
function noTrigger(io: Io, branch: string): string | null {
  const named = io.git(GIT_DEFAULT_BRANCH.slice(), io.cwd);
  const main = named.code === 0 ? named.stdout.trim().replace(REMOTE_PREFIX, "") : "";

  if (branch === main) return null;
  const prs = ghJson(io.gh(GH_OPEN_PRS(branch), io.cwd), prsSchema());

  if (prs === null || prs.length > 0) return null;
  const pushes = main === "" ? "the default branch" : main;

  return `nothing to wait on: ci runs on pushes to ${pushes} and on pull requests, and ${branch} has neither`;
}

/** The newest run of the target's commit on its branch, if there is one. */
function lookup(io: Io, target: Target): RunInfo | undefined {
  const runs = ghJson(io.gh(GH_LIST_COMMIT(target.sha), io.cwd), runsSchema()) ?? [];

  return newestFirst(runs.filter((run) => run.headBranch === target.branch))[0];
}

/** Looks every `POLL_MS` until `GIVE_UP_MS` have passed since `started`. */
async function poll(io: Io, target: Target, started: number): Promise<RunInfo | null> {
  await io.sleep(POLL_MS);
  const found = lookup(io, target);

  if (found !== undefined) return found;

  return io.now() - started >= GIVE_UP_MS ? null : poll(io, target, started);
}

/** Finds the target's run and waits for it. No run on the first look and no trigger for one is `nothing`. */
async function wait(io: Io, target: Target): Promise<Ended> {
  const started = io.now();
  let run = lookup(io, target);

  if (run === undefined) {
    const line = noTrigger(io, target.branch);

    if (line !== null) return { kind: "nothing", line };
    run = (await poll(io, target, started)) ?? undefined;
  }

  if (run === undefined) {
    const waited = `${GIVE_UP_MS / MS_PER_SECOND}s`;
    const line = `no ci run for ${target.sha.slice(0, SHA_SHOWN)} after ${waited}; check the workflow ran`;

    return { detail: `no ci run after ${waited}`, kind: "error", line };
  }

  io.stdout(`waiting for ci on ${target.sha.slice(0, SHA_SHOWN)} (run ${run.databaseId})…\n`);

  return finish(io, run, started);
}

function ioOf(deps: WaitDeps): Io {
  return {
    cwd: deps.cwd,
    fs: deps.fs,
    gh: deps.gh ?? spawnRunner("gh"),
    git: deps.git ?? spawnRunner("git"),
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? realSleep,
    stderr: deps.stderr,
    stdout: deps.stdout,
  };
}

/** The target of a wait, and how it ended; no target when there was nothing to find one with. */
async function execute(io: Io, deps: WaitDeps): Promise<{ target?: Target; ended: Ended }> {
  const target = deps.target === undefined ? locate(io, deps.branch) : givenTarget(io, deps.target);

  if ("error" in target) return { ended: { detail: target.error, kind: "error", line: target.error } };

  return { ended: await wait(io, target), target };
}

/**
 * Waits for the newest `ci` run of HEAD and reports how it ended, printing what the run printed: the waiting line, then
 * passed, the failed jobs with their logs, or the run that superseded it. A missing run, remote or gh login is `error`;
 * a branch ci does not run on is `nothing`. Nothing is recorded.
 */
export async function waitFor(deps: WaitDeps): Promise<WaitOutcome> {
  const executed = await execute(ioOf(deps), deps);

  return executed.ended;
}

const EXIT_OF = {
  error: EXIT_ERROR,
  failed: EXIT_FAILED,
  nothing: EXIT_NOTHING,
  passed: EXIT_PASSED,
  superseded: EXIT_SUPERSEDED,
};

/** Writes the record of a commit's outcome, and says so on stderr when it cannot. */
function record(io: Io, target: Target, ended: Ended): void {
  const failed = ended.kind === "failed" ? ended.jobs : [];
  const entry = { at: new Date(io.now()).toISOString(), branch: target.branch, failed, outcome: ended.kind };
  const where = { root: recordRoot(io.git, io.cwd), sha: target.sha };

  if (!writeRecord(where, entry, io.fs)) io.stderr(`repo ci wait: cannot record the outcome for ${target.sha}\n`);
}

/** `repo ci wait [<branch>]`: prints the outcome, records it, and returns the exit code. */
export async function waitMain(deps: WaitDeps): Promise<number> {
  const io = ioOf(deps);
  const { target, ended } = await execute(io, deps);

  if (ended.kind === "error") io.stderr(`repo ci wait: ${ended.line}\n`);

  if (ended.kind === "nothing") io.stdout(`${ended.line}\n`);

  if (target !== undefined) record(io, target, ended);

  return EXIT_OF[ended.kind];
}
