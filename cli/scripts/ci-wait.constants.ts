import { REPO, STATE } from "../repo-dirs.ts";

/** Milliseconds between looks for the run, and how long to look before giving up. */
export const POLL_MS = 10_000;
export const GIVE_UP_MS = 120_000;

/** How long the whole wait, finding the run and watching it, may take; the ci job's own timeout is 40 minutes. */
export const WAIT_BOUND_MS: number = 45 * 60_000;
export const WAIT_BOUND_LABEL = "45m";
export const MS_PER_SECOND = 1000;

/** Characters of a sha shown. */
export const SHA_SHOWN = 7;
const WORKFLOW = "ci.yml";
export const EXIT_PASSED = 0;
export const EXIT_FAILED = 1;
export const EXIT_SUPERSEDED = 2;
export const EXIT_NOTHING = 3;
export const EXIT_ERROR = 4;

/** Where the outcome of each waited-on commit is recorded, under the main checkout's root. */
export const RECORD_DIR: string = `${REPO}/${STATE}/ci`;
export const RECORD_TEMP_SUFFIX = ".tmp";

/** Job conclusions that are not a failure. */
export const NOT_FAILED: readonly string[] = ["success", "skipped", "neutral"];
export const STATUS_COMPLETED = "completed";
export const CONCLUSION_SUCCESS = "success";
export const CONCLUSION_CANCELLED = "cancelled";
export const HEAD_REF = "HEAD";

export function GIT_REV(ref: string): string[] {
  return ["rev-parse", ref];
}

export const GIT_DEFAULT_BRANCH: readonly string[] = ["rev-parse", "--abbrev-ref", "origin/HEAD"];
export const REMOTE_PREFIX = "origin/";
const REMOTE_REFS = "refs/remotes/origin/";

/** The commit at the tip of a branch on origin, as last fetched; fails when origin has no such branch. */
export function GIT_REMOTE_TIP(branch: string): string[] {
  return ["rev-parse", "--verify", "--quiet", `${REMOTE_REFS}${branch}`];
}

export const GIT_BRANCH: readonly string[] = ["rev-parse", "--abbrev-ref", "HEAD"];

export function GIT_REMOTES(sha: string): string[] {
  return ["branch", "-r", "--contains", sha];
}

export const GH_AUTH: readonly string[] = ["auth", "status"];
const GH_LIST_FIELDS = "databaseId,status,conclusion,event,headBranch,createdAt";
const GH_BRANCH_FIELDS = "databaseId,createdAt";
const GH_VIEW_FIELDS = "status,conclusion,jobs";

export function GH_LIST_COMMIT(sha: string): string[] {
  return ["run", "list", "--commit", sha, "--workflow", WORKFLOW, "--json", GH_LIST_FIELDS];
}

export function GH_LIST_BRANCH(branch: string): string[] {
  return ["run", "list", "--branch", branch, "--workflow", WORKFLOW, "--json", GH_BRANCH_FIELDS];
}

export function GH_OPEN_PRS(branch: string): string[] {
  return ["pr", "list", "--head", branch, "--state", "open", "--json", "number"];
}

export function GH_VIEW(id: number): string[] {
  return ["run", "view", String(id), "--json", GH_VIEW_FIELDS];
}

export function GH_LOGS(id: number): string[] {
  return ["run", "view", String(id), "--log-failed"];
}
