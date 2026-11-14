/** A release world under the pull-request workflow, and a fake gh whose pull requests follow origin's branches. */
import {
  NAME,
  fakeGh as ciGh,
  feat,
  gitIn,
  world,
  type Behavior,
  type World,
} from "../../__fixtures__/release-world.ts";
import type { Captured } from "../../scripts/lint.ts";
import type { Runner } from "../../scripts/ci-wait.ts";
import type { PrState } from "../../scripts/worktree.types.ts";

export const TAG = `${NAME}@0.1.1`;
export const SUBJECT = `chore: release ${TAG}`;
export const PR_BASE = "https://github.com/o/r/pull/";

/** One pull request the fake holds: its number, state and head commit. */
type FakePr = { number: number; state: PrState; head: string };

/** A gh whose `pr list --state all` and `pr create` follow `prs`, and whose other calls are `repo ci wait`'s fake. */
export type PrGh = {
  gh: Runner;
  calls: string[][];
  prs: Map<string, FakePr>;
  /** What `pr create` answers instead of opening one. */
  fail?: Captured;
  /** How the CI runs the fake answers end. */
  ci: Behavior;
};

const ok = (stdout: string): Captured => ({ code: 0, stderr: "", stdout });

/** The tip of `branch` on origin, or "" when origin has none. */
function originTip(w: World, branch: string): string {
  return gitIn(w.remote, "for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`);
}

/** The fake's answer to a `pr list` or `pr create` naming `--head <branch>`. */
function prAnswer(w: World, fake: PrGh, args: string[]): Captured {
  const branch = args[args.indexOf("--head") + 1] /* finish names the head of every pr call */ as string;

  if (args[1] === "create") {
    if (fake.fail !== undefined) return fake.fail;
    fake.prs.set(branch, { head: originTip(w, branch), number: 9 + fake.prs.size, state: "OPEN" });
    return ok(`\n${PR_BASE}${fake.prs.get(branch)?.number}\n`);
  }

  const pr = fake.prs.get(branch);
  if (pr === undefined) return ok("[]");
  pr.head = originTip(w, branch) || pr.head;
  return ok(JSON.stringify([{ headRefOid: pr.head, number: pr.number, state: pr.state, url: PR_BASE + pr.number }]));
}

/** A fake gh for the world `w`, recording every call. */
export function prGh(w: World): PrGh {
  const fake: PrGh = { calls: [], ci: {}, gh: () => ok(""), prs: new Map() };
  fake.gh = (args, cwd) => {
    fake.calls.push(args);
    const ours = args[0] === "pr" && (args[1] === "create" || args.includes("all"));
    return ours ? prAnswer(w, fake, args) : ciGh(fake.ci)(args, cwd);
  };
  return fake;
}

/** A tagged 0.1.0 world under `workflow` with one feat on main and origin waiting to be released. */
export function prWorld(workflow = "pull-request"): World {
  const w = world({
    ".gitignore": ".worktrees/\n",
    "repo.config.ts": `export default { packs: ["release"], workflow: "${workflow}" };\n`,
  });
  feat(w);
  return w;
}

/** The local `wt/release-*` branches. */
export function releaseBranches(w: World): string[] {
  const listed = gitIn(w.work, "for-each-ref", "--format=%(refname:short)", "refs/heads/wt/release-*");

  return listed.split("\n").filter(Boolean);
}

/** Puts a commit on origin's main above it, its tree `tree` and subject `subject`; its sha. */
export function pushOnOrigin(w: World, tree: string, subject: string): string {
  gitIn(w.work, "fetch", "-q", "origin");
  const sha = gitIn(w.work, "commit-tree", tree, "-p", "origin/main", "-m", subject);
  gitIn(w.work, "push", "-q", "origin", `${sha}:refs/heads/main`);
  return sha;
}

/** Squash-merges origin's `branch` into origin's main as GitHub does, its subject given `(#<n>)`; the merge's sha. */
export function squashMerge(w: World, fake: PrGh, branch: string): string {
  const pr = fake.prs.get(branch) /* every merged branch was opened first */ as FakePr;
  gitIn(w.work, "fetch", "-q", "origin");
  const subject = gitIn(w.work, "log", "-1", "--format=%s", `origin/${branch}`);
  const sha = pushOnOrigin(w, gitIn(w.work, "rev-parse", `origin/${branch}^{tree}`), `${subject} (#${pr.number})`);
  pr.head = originTip(w, branch);
  pr.state = "MERGED";
  return sha;
}
