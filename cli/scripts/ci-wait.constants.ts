/** Milliseconds between looks for the run, and how long to look before giving up. */
export const POLL_MS = 10_000;
export const GIVE_UP_MS = 120_000;
export const MS_PER_SECOND = 1000;
/** Characters of a sha shown. */
export const SHA_SHOWN = 7;
const WORKFLOW = "ci.yml";
export const EXIT_PASSED = 0;
export const EXIT_FAILED = 1;
export const EXIT_SUPERSEDED = 2;
/** Job conclusions that are not a failure. */
export const NOT_FAILED: readonly string[] = ["success", "skipped", "neutral"];
export const CONCLUSION_SUCCESS = "success";
export const CONCLUSION_CANCELLED = "cancelled";
export const GIT_HEAD: readonly string[] = ["rev-parse", "HEAD"];
export const GIT_BRANCH: readonly string[] = ["rev-parse", "--abbrev-ref", "HEAD"];
export const GIT_REMOTES = (sha: string): string[] => ["branch", "-r", "--contains", sha];
export const GH_AUTH: readonly string[] = ["auth", "status"];
const GH_LIST_FIELDS = "databaseId,status,conclusion,event,headBranch,createdAt";
const GH_BRANCH_FIELDS = "databaseId,createdAt";
const GH_VIEW_FIELDS = "conclusion,jobs";
export const GH_LIST_COMMIT = (sha: string): string[] => [
  "run",
  "list",
  "--commit",
  sha,
  "--workflow",
  WORKFLOW,
  "--json",
  GH_LIST_FIELDS,
];
export const GH_LIST_BRANCH = (branch: string): string[] => [
  "run",
  "list",
  "--branch",
  branch,
  "--workflow",
  WORKFLOW,
  "--json",
  GH_BRANCH_FIELDS,
];
export const GH_WATCH = (id: number): string[] => ["run", "watch", String(id), "--exit-status"];
export const GH_VIEW = (id: number): string[] => ["run", "view", String(id), "--json", GH_VIEW_FIELDS];
export const GH_LOGS = (id: number): string[] => ["run", "view", String(id), "--log-failed"];
