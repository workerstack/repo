/** A child's `need:` of search, exec, slice or fetch jobs is run in place and handed back, capped per turn. */
import type { HookInput } from "./hook-input.ts";
import { resolveJobCwd } from "./job-args.ts";
import { runJob } from "./job.ts";
import { PASS, replyWith } from "./orchestrate-reply.ts";
import { readStampInt, writeStamp } from "./orchestrate-stamps.ts";
import { payloadAssistantMessage } from "./orchestrate-transcript.ts";
import { INTERCEPT_JOBS, MAX_INTERCEPT, MAX_NEED_JOBS, NEED_INTERCEPT_STAMP } from "./orchestrate.constants.ts";
import type { HookResult } from "./orchestrate.types.ts";
import { parseNeed, type NeedResult } from "./parse-need.ts";
import { resolveRoots, type Roots } from "./workspace-root.ts";

type NeedJob = Extract<NeedResult, { ok: true }>["jobs"][number];

/** True when the host is already continuing because a stop hook blocked. */
export function isStopActive(data: HookInput): boolean {
  return data.stopHookActive === true || data.stop_hook_active === true;
}

/** One job's text; null when it falls back, so the child gets the need answered the usual way. */
function runOne(job: NeedJob, roots: Roots): string | null {
  try {
    const jobCwd = job.cwd === undefined ? roots.cwd : resolveJobCwd(job.cwd, roots.cwd);

    if (jobCwd === null) return null;
    const { query, path, glob, stash, from, to } = job;
    const result = runJob({ cwd: jobCwd, from, glob, job: job.job, path, query, root: roots.root, stash, to });

    return result.fallback ? null : result.text.trimEnd();
  } catch {
    return null;
  }
}

function runJobs(jobs: NeedJob[], roots: Roots): string[] | null {
  const parts: string[] = [];

  for (const job of jobs) {
    const text = runOne(job, roots);

    if (text === null) return null;
    parts.push(text);
  }

  return parts;
}

export function interceptNeed(data: HookInput, hookEventName: string): HookResult {
  const roots = resolveRoots(data);

  if (isStopActive(data)) return PASS;
  const parsed = parseNeed(payloadAssistantMessage(data));

  if (!parsed.ok || parsed.jobs.length > MAX_NEED_JOBS || !parsed.jobs.every((j) => INTERCEPT_JOBS.has(j.job)))
    return PASS;
  const n = readStampInt(data, NEED_INTERCEPT_STAMP);

  if (n >= MAX_INTERCEPT) return PASS;
  const parts = runJobs(parsed.jobs, roots);

  if (parts === null) return PASS;
  writeStamp(data, NEED_INTERCEPT_STAMP, String(n + 1));

  return replyWith({ decision: "block", hookSpecificOutput: { additionalContext: parts.join("\n"), hookEventName } });
}
