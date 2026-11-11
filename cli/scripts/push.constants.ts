/** What `repo push` reads from git, how far back a branch counts as recent, and the codes it exits with. */
export const REMOTE = "origin";
/** The words a shell command runs `repo push` with: `bun repo push` or `repo push`. */
export const BUN = "bun";
export const REPO = "repo";
export const REMOTE_PREFIX: string = `${REMOTE}/`;
/** Branches committed to within this many seconds count as recent: one week. */
export const RECENT_SECONDS = 604_800;
export const MS_PER_SECOND = 1000;
/** How many reflog entries and newest heads name the recent branches. */
const REFLOG_COUNT = "30";
export const NEWEST_HEADS = 8;
export const GIT_CURRENT: readonly string[] = ["symbolic-ref", "--quiet", "--short", "HEAD"];
export const GIT_DEFAULT: readonly string[] = ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"];
export const GIT_REFLOG: readonly string[] = ["reflog", "-n", REFLOG_COUNT, "--format=%gs"];
export const GIT_HEADS: readonly string[] = [
  "for-each-ref",
  "--sort=-committerdate",
  "--format=%(refname:short) %(committerdate:unix)",
  "refs/heads",
];
/** One line of GIT_HEADS: a branch and its commit date in unix seconds. */
export const HEAD_LINE: RegExp = /^(?<name>\S+) (?<date>\d+)$/gm;
/** The upstream `branch` tracks; fails when it has none. */
export function gitUpstream(branch: string): string[] {
  return ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{upstream}`];
}
/** The reflog subject of a checkout, naming the branch left and the branch entered. */
export const CHECKOUT_MOVE: RegExp = /^checkout: moving from (?<from>\S+) to (?<to>\S+)$/gm;
/** `repo push` asked which branch: the default has more than one recent branch. */
export const EXIT_ASK = 5;
/** `repo push` found nothing to push: a detached HEAD or no default branch on origin. */
export const EXIT_NO_BRANCH = 4;
/** `repo push` refused a managed worktree's branch, or git refused the push. */
export const EXIT_REFUSED = 1;
/** What `repo push` prints for more than one argument or an option. */
export const USAGE = "usage: repo push [<branch>]";
/** The `repo push` line of `repo --help`. */
export const PUSH_SUMMARY: string =
  "Push the named branch, or the one the recent-branch table picks, and wait on its ci run (exit 5: name the branch)";
