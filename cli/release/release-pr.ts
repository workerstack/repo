/**
 * `repo release` under the pull-request workflow: the release commit is made in a `release-<version>-<short HEAD>`
 * worktree and reaches the default branch through its pull request, which `finishWith` opens and later lands; main is
 * never pushed. Each run first finishes the release branch an earlier run left, so a rerun converges.
 */
import type { Result } from "../result.ts";
import { addWorktree, finishWith } from "../scripts/worktree-lifecycle.ts";
import { BRANCH_PREFIX, HEADS_REF } from "../scripts/worktree.constants.ts";
import type { FinishResult } from "../scripts/worktree.types.ts";
import { commitWithSubject, defaultBranch, must, read, type Tools } from "./git.ts";
import type { Plan } from "./plan.ts";
import { refuse } from "./refuse.ts";
import { PREFIX } from "./release-messages.constants.ts";
import { aheadUnderPr, manyReleaseBranches, prNotMerged, prOpened } from "./release-pr-messages.constants.ts";
import { GIT_FETCH, GIT_HEAD, RELEASE_SUBJECT, SHA_SHOWN } from "./release.constants.ts";

/** Where the release prints, and the steps it shares with the other workflows: plan, commit, wait on CI and tag. */
export type ReleaseSteps = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  plan: () => Promise<Result<Plan, string>>;
  /** Writes and commits the release in the checkout at `cwd`. */
  commit: (cwd: string, plan: Plan) => void;
  /** Waits on CI for HEAD and tags `sha` once it passed; the exit code. */
  tag: (plan: Plan, sha: string) => Promise<number>;
};

/** The worktree name every release worktree starts with. */
const RELEASE_NAME = "release-";

/** The local release branches, whether or not a worktree still holds them. */
const RELEASE_BRANCHES: readonly string[] = [
  "for-each-ref",
  "--format=%(refname:short)",
  `${HEADS_REF}${BRANCH_PREFIX}${RELEASE_NAME}*`,
];

/** How many commits the local `branch` has that origin's lacks. */
function aheadOf(t: Tools, branch: string): number {
  return Number(read(t, ["rev-list", "--count", `origin/${branch}..${HEADS_REF}${branch}`]));
}

/** The exit code `finished` ends the run with, or null when the release goes on: landed, or nothing to finish. */
function handBack(s: ReleaseSteps, finished: FinishResult, tag: string): number | null {
  if (!("kind" in finished) || finished.kind === "landed") return null;

  if (finished.kind === "updated") return refuse(s, PREFIX, prNotMerged(finished.url, tag));
  s.stdout(`${PREFIX}${prOpened(finished.url, tag)}\n`);

  return 0;
}

/** Finish the release branch `branch` through its pull request; the exit code, or null when the release goes on. */
function finishBranch(t: Tools, s: ReleaseSteps, branch: string): number | null {
  // The tag is read off the release commit before a landing finish deletes the branch.
  const tag = read(t, ["log", "-1", "--format=%s", HEADS_REF + branch]).slice(RELEASE_SUBJECT("").length);
  const finish = finishWith({ gh: t.gh, workflow: () => "pull-request" });

  return handBack(s, finish(t.cwd, branch.slice(BRANCH_PREFIX.length), t.cwd), tag);
}

/**
 * Release the checkout at `t.cwd` through a pull request: refuse a default branch ahead of origin, finish the release
 * branch an earlier run left, then plan. A pending release commit already merged is waited on and tagged; a new one is
 * committed in a fresh worktree and finished as a rerun would finish it, which opens its pull request.
 */
export async function releaseByPullRequest(t: Tools, s: ReleaseSteps): Promise<number> {
  must(t, GIT_FETCH);
  const main = defaultBranch(t);
  const ahead = aheadOf(t, main);

  if (ahead > 0) return refuse(s, PREFIX, aheadUnderPr(main, ahead));
  const branches = read(t, RELEASE_BRANCHES).split("\n").filter(Boolean);

  if (branches.length > 1) return refuse(s, PREFIX, manyReleaseBranches(branches));
  const [branch] = branches;
  const code = branch === undefined ? null : finishBranch(t, s, branch);

  if (code !== null) return code;
  const planned = await s.plan();

  if (!planned.ok) return refuse(s, PREFIX, planned.error);
  const plan = planned.value;

  // The plan found this pending release commit; later merges may sit above it, so HEAD is not the release.
  if (plan.action === "none") {
    const pending = commitWithSubject(t, RELEASE_SUBJECT(plan.tag));

    return s.tag(plan, pending /* a plan with nothing to commit has a pending release commit */ as string);
  }

  const made = addWorktree(t.cwd, `${RELEASE_NAME}${plan.version}-${read(t, GIT_HEAD).slice(0, SHA_SHOWN)}`);
  s.commit(made.path, plan);

  return releaseByPullRequest(t, s);
}
