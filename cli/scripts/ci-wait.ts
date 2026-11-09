/**
 * `repo ci wait`: finds the newest `ci` run for HEAD on the current branch, waits for it, and exits 0 when it passed,
 * 2 when a newer run on the branch superseded it (it was cancelled), 1 when it failed (with the failed jobs and their
 * logs) or could not be found.
 */
import { z } from "zod";
import {
  CONCLUSION_CANCELLED,
  CONCLUSION_SUCCESS,
  EXIT_FAILED,
  EXIT_PASSED,
  EXIT_SUPERSEDED,
  GH_AUTH,
  GH_LIST_BRANCH,
  GH_LIST_COMMIT,
  GH_LOGS,
  GH_VIEW,
  GH_WATCH,
  GIT_BRANCH,
  GIT_HEAD,
  GIT_REMOTES,
  GIVE_UP_MS,
  MS_PER_SECOND,
  NOT_FAILED,
  POLL_MS,
  SHA_SHOWN,
} from "./ci-wait.constants.ts";
import { realSleep, spawnRunner, type Runner } from "./ci-wait-run.ts";

export type { Runner } from "./ci-wait-run.ts";
export type WaitDeps = {
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Milliseconds; the clock the wait for the run is measured on. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  git?: Runner;
  gh?: Runner;
  /** The commit and branch to wait on; skips the HEAD, branch and remote checks and keeps the gh login check. */
  target?: Target;
};
/** How the wait for HEAD's run ended: `error` carries the line `repo ci wait` prints and a shorter `detail`. */
export type WaitOutcome =
  | { kind: "passed" }
  | { kind: "failed" }
  | { kind: "superseded" }
  | { kind: "error"; line: string; detail: string };
type Io = Required<Omit<WaitDeps, "target">>;
/** A commit and the branch whose `ci` run for it is waited on. */
export type Target = { sha: string; branch: string };
type RunInfo = { databaseId: number; createdAt: string; headBranch: string };

const runsSchema = () => z.array(z.object({ databaseId: z.number(), createdAt: z.string(), headBranch: z.string() }));
const branchRunsSchema = () => z.array(z.object({ databaseId: z.number(), createdAt: z.string() }));
const viewSchema = () =>
  z.object({
    conclusion: z.string(),
    jobs: z.array(z.object({ name: z.string(), conclusion: z.string() })),
  });

/** The JSON in a gh run's stdout, parsed against `schema`; null when the run failed or the text is not that. */
export function readJson<T>(got: { code: number; stdout: string }, schema: z.ZodType<T>): T | null {
  if (got.code !== 0) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(got.stdout));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const newestFirst = <T extends { createdAt: string }>(runs: T[]): T[] =>
  [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const GH_LOGIN = "gh is not installed or not logged in; run `gh auth login`";

/** HEAD and the current branch, or why there is nothing to wait on. */
function locate(io: Io): Target | { error: string } {
  const head = io.git(GIT_HEAD.slice(), io.cwd);
  const sha = head.stdout.trim();
  if (head.code !== 0 || sha === "") {
    return { error: `cannot read HEAD (${head.stderr.trim()}); run it inside a git checkout` };
  }
  if (io.git(GIT_REMOTES(sha), io.cwd).stdout.trim() === "") {
    return { error: `${sha.slice(0, SHA_SHOWN)} is not on any remote branch; push it first` };
  }
  if (io.gh(GH_AUTH.slice(), io.cwd).code !== 0) return { error: GH_LOGIN };
  return { sha, branch: io.git(GIT_BRANCH.slice(), io.cwd).stdout.trim() };
}

/** The given target once gh is logged in, or why there is nothing to wait on. */
function givenTarget(io: Io, target: Target): Target | { error: string } {
  return io.gh(GH_AUTH.slice(), io.cwd).code === 0 ? target : { error: GH_LOGIN };
}

/** The newest run of HEAD on the branch, looking every `POLL_MS` until `GIVE_UP_MS` have passed since `started`. */
async function findRun(io: Io, target: Target, started: number): Promise<RunInfo | null> {
  const runs = readJson(io.gh(GH_LIST_COMMIT(target.sha), io.cwd), runsSchema()) ?? [];
  const [newest] = newestFirst(runs.filter((run) => run.headBranch === target.branch));
  if (newest !== undefined) return newest;
  if (io.now() - started >= GIVE_UP_MS) return null;
  await io.sleep(POLL_MS);
  return findRun(io, target, started);
}

/** The newest run on the branch that was created after `run`. */
function newerRun(io: Io, run: RunInfo): { databaseId: number } | undefined {
  const runs = readJson(io.gh(GH_LIST_BRANCH(run.headBranch), io.cwd), branchRunsSchema()) ?? [];
  return newestFirst(runs.filter((other) => other.createdAt > run.createdAt))[0];
}

/** Prints the failed line and the failed steps' logs. */
function failure(io: Io, run: RunInfo, view: z.infer<ReturnType<typeof viewSchema>> | null): WaitOutcome {
  const names = (view?.jobs ?? []).filter((item) => !NOT_FAILED.includes(item.conclusion)).map((item) => item.name);
  const what = names.length > 0 ? names.join(", ") : `ci ${view?.conclusion || "run has no result"}`;
  io.stdout(`failed: ${what}; logs below\n`);
  const logs = io.gh(GH_LOGS(run.databaseId), io.cwd);
  io.stdout(logs.code === 0 ? logs.stdout : "logs expired\n");
  return { kind: "failed" };
}

/** Watches `run` to its end, then reads its result and reports it. */
function conclude(io: Io, run: RunInfo): WaitOutcome {
  io.gh(GH_WATCH(run.databaseId), io.cwd);
  const view = readJson(io.gh(GH_VIEW(run.databaseId), io.cwd), viewSchema());
  if (view?.conclusion === CONCLUSION_SUCCESS) {
    io.stdout("passed\n");
    return { kind: "passed" };
  }
  const newer = view?.conclusion === CONCLUSION_CANCELLED ? newerRun(io, run) : undefined;
  if (newer !== undefined) {
    io.stdout(`superseded by run ${newer.databaseId} on ${run.headBranch}\n`);
    return { kind: "superseded" };
  }
  return failure(io, run, view);
}

/**
 * Waits for the newest `ci` run of HEAD and reports how it ended, printing what the run printed: the waiting line, then
 * passed, the failed jobs with their logs, or the run that superseded it. A missing run, remote or gh login is `error`.
 */
export async function waitFor(deps: WaitDeps): Promise<WaitOutcome> {
  const io: Io = {
    cwd: deps.cwd,
    stdout: deps.stdout,
    stderr: deps.stderr,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? realSleep,
    git: deps.git ?? spawnRunner("git"),
    gh: deps.gh ?? spawnRunner("gh"),
  };
  const target = deps.target === undefined ? locate(io) : givenTarget(io, deps.target);
  if ("error" in target) return { kind: "error", line: target.error, detail: target.error };
  const short = target.sha.slice(0, SHA_SHOWN);
  const run = await findRun(io, target, io.now());
  if (run === null) {
    const waited = `${GIVE_UP_MS / MS_PER_SECOND}s`;
    return {
      kind: "error",
      line: `no ci run for ${short} after ${waited}; check the workflow ran`,
      detail: `no ci run after ${waited}`,
    };
  }
  io.stdout(`waiting for ci on ${short} (run ${run.databaseId})…\n`);
  return conclude(io, run);
}

const EXIT_OF = { passed: EXIT_PASSED, failed: EXIT_FAILED, superseded: EXIT_SUPERSEDED, error: EXIT_FAILED };

export async function waitMain(deps: WaitDeps): Promise<number> {
  const outcome = await waitFor(deps);
  if (outcome.kind === "error") deps.stderr(`repo ci wait: ${outcome.line}\n`);
  return EXIT_OF[outcome.kind];
}
