/** The second half of `repo ci wait`: looking at a run until it completes or the wait is out of time, then reporting it. */
import { z } from "zod";
import {
  CONCLUSION_CANCELLED,
  CONCLUSION_SUCCESS,
  GH_LIST_BRANCH,
  GH_LOGS,
  GH_VIEW,
  NOT_FAILED,
  POLL_MS,
  STATUS_COMPLETED,
  WAIT_BOUND_LABEL,
  WAIT_BOUND_MS,
} from "./ci-wait.constants.ts";
import type { Runner } from "./ci-wait-run.ts";

/** What the wait on one run ended as; `error` carries the line `repo ci wait` prints and a shorter `detail`. */
export type RunOutcome =
  | { kind: "passed" }
  | { kind: "failed"; jobs: string[] }
  | { kind: "superseded" }
  | { kind: "error"; line: string; detail: string };
export type RunInfo = { databaseId: number; createdAt: string; headBranch: string };
/** What polling a run needs: gh, the clock, a sleep and where to print. */
export type PollIo = {
  cwd: string;
  stdout: (s: string) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  gh: Runner;
};
type View = z.infer<ReturnType<typeof viewSchema>>;

const branchRunsSchema = () => z.array(z.object({ databaseId: z.number(), createdAt: z.string() }));
const viewSchema = () =>
  z.object({
    status: z.string(),
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

export const newestFirst = <T extends { createdAt: string }>(runs: T[]): T[] =>
  [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** The newest run on the branch that was created after `run`. */
function newerRun(io: PollIo, run: RunInfo): { databaseId: number } | undefined {
  const runs = readJson(io.gh(GH_LIST_BRANCH(run.headBranch), io.cwd), branchRunsSchema()) ?? [];
  return newestFirst(runs.filter((other) => other.createdAt > run.createdAt))[0];
}

/** Prints the failed line and the failed steps' logs. */
function failure(io: PollIo, run: RunInfo, view: View): RunOutcome {
  const jobs = view.jobs.filter((item) => !NOT_FAILED.includes(item.conclusion)).map((item) => item.name);
  io.stdout(`failed: ${jobs.length > 0 ? jobs.join(", ") : `ci ${view.conclusion}`}; logs below\n`);
  const logs = io.gh(GH_LOGS(run.databaseId), io.cwd);
  io.stdout(logs.code === 0 ? logs.stdout : "logs expired\n");
  return { kind: "failed", jobs };
}

/** Reports a finished run: passed, superseded by a newer run on its branch, or failed. */
function conclude(io: PollIo, run: RunInfo, view: View): RunOutcome {
  if (view.conclusion === CONCLUSION_SUCCESS) {
    io.stdout("passed\n");
    return { kind: "passed" };
  }
  const newer = view.conclusion === CONCLUSION_CANCELLED ? newerRun(io, run) : undefined;
  if (newer === undefined) return failure(io, run, view);
  io.stdout(`superseded by run ${newer.databaseId} on ${run.headBranch}\n`);
  return { kind: "superseded" };
}

/**
 * Looks at `run` every `POLL_MS` until it completes, or the wait since `started` passes `WAIT_BOUND_MS`. Polling
 * `gh run view` instead of running `gh run watch` keeps the bound on the injected clock and sleep, which a blocking
 * child process could not be given.
 */
export async function finish(io: PollIo, run: RunInfo, started: number): Promise<RunOutcome> {
  const view = readJson(io.gh(GH_VIEW(run.databaseId), io.cwd), viewSchema());
  if (view?.status === STATUS_COMPLETED) return conclude(io, run, view);
  if (io.now() - started >= WAIT_BOUND_MS) {
    const id = run.databaseId;
    const line = `run ${id} still running after ${WAIT_BOUND_LABEL}; check it with \`gh run view ${id}\``;
    return { kind: "error", line, detail: `run ${id} still running after ${WAIT_BOUND_LABEL}` };
  }
  await io.sleep(POLL_MS);
  return finish(io, run, started);
}
