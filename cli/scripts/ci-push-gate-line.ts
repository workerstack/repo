/** The push gate's Stop line for one branch: what the records of its pushed commits say is still open. */
import type nodeFs from "node:fs";
import type path from "node:path";

import { tryJson } from "../json.ts";
import { recordPath, recordSchema, type WaitRecord } from "./ci-wait-record.ts";
import type { Runner } from "./ci-wait-run.ts";
import { SHA_SHOWN } from "./ci-wait.constants.ts";

const FAILED_ROUNDS = 3;
const TERMINAL: readonly string[] = ["passed", "nothing", "error"];

const BLOCKED_HINT =
  "; if only the user can fix a job, run bun repo backlog add 'blocked: `<job>` <why>' " +
  "and name that line in your reply";

/** What the gate reads, writes and asks; the real ones by default. */
export type GateDeps = {
  git: Runner;
  p: typeof path;
  fs: Pick<typeof nodeFs, "readFileSync" | "writeFileSync" | "mkdirSync">;
  now: () => Date;
};

/** Where the records live, whether this Stop already blocked once, and the jobs only the user can fix. */
export type LineCtx = { root: string; active: boolean; blocked: ReadonlySet<string> };

/** One pushed commit of a branch. */
type Push = { branch: string; sha: string };

function readRecord(deps: GateDeps, root: string, sha: string): WaitRecord | null {
  try {
    return tryJson(recordSchema(), deps.fs.readFileSync(recordPath(root, sha), "utf8")) ?? null;
  } catch {
    return null;
  }
}

/** The jobs not blocked that failed in three or more of the branch's pushed commits. */
function repeatedJobs(deps: GateDeps, ctx: LineCtx, pushed: Push[]): string[] {
  const counts = new Map<string, number>();

  for (const sha of new Set(pushed.map((p) => p.sha))) {
    const record = readRecord(deps, ctx.root, sha);
    const failed = record?.outcome === "failed" ? record.failed : [];

    for (const job of failed.filter((j) => !ctx.blocked.has(j))) counts.set(job, (counts.get(job) ?? 0) + 1);
  }

  return [...counts].filter(([, n]) => n >= FAILED_ROUNDS).map(([job]) => job);
}

/**
 * Whether a later commit on `origin/<branch>` that contains the pushed commit has a passed record: ci.yml cancels a
 * run on the next push, so a newer green run is the only result such a commit gets.
 */
function settledByLater(deps: GateDeps, ctx: LineCtx, push: Push): boolean {
  const later = deps.git(["rev-list", "--ancestry-path", `${push.sha}..origin/${push.branch}`], ctx.root);

  return (
    later.code === 0 &&
    later.stdout
      .split("\n")
      .filter((s) => s !== "")
      .some((s) => readRecord(deps, ctx.root, s)?.outcome === "passed")
  );
}

/**
 * The Stop line for one branch's pushes, or null when its newest landed commit is settled: by its own terminal record,
 * or by a later passed commit that contains it, which also proves a failure it had is fixed on the branch.
 */
export function lineFor(deps: GateDeps, ctx: LineCtx, pushed: Push[]): string | null {
  const branch = String(pushed[0]?.branch);

  const landed = pushed.filter(
    (p) => deps.git(["merge-base", "--is-ancestor", p.sha, `origin/${branch}`], ctx.root).code === 0,
  );

  const newest = landed[landed.length - 1];

  if (newest === undefined) return null;
  const record = readRecord(deps, ctx.root, newest.sha);

  if (record !== null && TERMINAL.includes(record.outcome)) return null;

  if (settledByLater(deps, ctx, newest)) return null;
  const short = newest.sha.slice(0, SHA_SHOWN);
  const wait = `\`bun repo ci wait ${branch}\``;

  if (record?.outcome !== "failed") {
    return (
      `Stop: you pushed ${short} to ${branch} and its ci run has no result; ` +
      `run ${wait} in the background and fix it if it fails`
    );
  }

  return failedLine(deps, ctx, { branch, failed: record.failed, pushed, short, wait });
}

/** The Stop line for a branch whose newest landed commit failed `failed`; null when every job is blocked. */
function failedLine(
  deps: GateDeps,
  ctx: LineCtx,
  run: { branch: string; failed: string[]; pushed: Push[]; short: string; wait: string },
): string | null {
  const open = run.failed.filter((job) => !ctx.blocked.has(job));

  // An empty list says nothing about which jobs failed, so it is never released.
  if (run.failed.length > 0 && open.length === 0) return null;
  const repeated = repeatedJobs(deps, ctx, run.pushed);

  if (repeated.length > 0) {
    const report =
      `Stop: ${repeated.join(", ")} failed ${FAILED_ROUNDS} times on ${run.branch} this session; ` +
      "report the failure and its logs to the user, then stop";

    return ctx.active ? null : report;
  }

  return (
    `Stop: ci failed on ${run.short} on ${run.branch} (${open.join(", ")}); ` +
    `fix it in a new worktree, push, and run ${run.wait} in the background${BLOCKED_HINT}`
  );
}
