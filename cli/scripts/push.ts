/**
 * `repo push [<branch>]`: pushes the named branch, or the one the recent-branch table picks, with `-u origin` when it
 * has no upstream, then waits on its ci run and exits with `repo ci wait`'s code. Exits 5 when the default branch has
 * several recent branches to choose from, 4 on a detached HEAD or no default branch, 1 on a managed worktree's branch
 * or a push git refused.
 */
import { inheritRunner, spawnRunner } from "./ci-wait-run.ts";
import { waitMain, type WaitDeps } from "./ci-wait.ts";
import { pickTarget, type PushTarget } from "./push-target.ts";
import { EXIT_ASK, EXIT_NO_BRANCH, EXIT_REFUSED, gitUpstream, REMOTE, USAGE } from "./push.constants.ts";
import { BRANCH_PREFIX } from "./worktree.constants.ts";

/**
 * Where `repo push` runs, what it prints to, its clock in milliseconds (the recent-branch table's too), and the
 * runners, sleep and record fs of the ci wait it ends with; each defaults to the real one.
 */
export type PushDeps = Partial<Omit<WaitDeps, "branch" | "target">>;

type Refusal = Exclude<PushTarget, { kind: "branch" }>;

/** Why `repo push` pushes nothing, and its exit code. */
function refusal(target: Refusal): [string, number] {
  if (target.kind === "ask") {
    const { base, branches } = target;
    const line = `${base} has ${branches.length} recent branches (${branches.join(", ")})`;

    return [`${line}; run \`bun repo push <branch>\` with the one to push`, EXIT_ASK];
  }

  if (target.kind === "worktree") {
    const finish = `run \`bun repo worktree finish ${target.name}\` from the root, then \`bun repo push\` there`;

    return [`${target.branch} is a managed worktree; ${finish}`, EXIT_REFUSED];
  }

  if (target.kind === "detached")
    return ["HEAD is detached; check out the branch to push, or run `bun repo push <branch>`", EXIT_NO_BRANCH];

  return ["origin has no default branch; run `git remote set-head origin --auto`", EXIT_NO_BRANCH];
}

/** The target an explicit branch names: it, or a managed worktree's branch to send to finish. */
function named(branch: string): PushTarget {
  if (!branch.startsWith(BRANCH_PREFIX)) return { branch, kind: "branch" };

  return { branch, kind: "worktree", name: branch.slice(BRANCH_PREFIX.length) };
}

/** The deps `repo push` reads itself, each the given one or the real one. */
function filled(deps: PushDeps) {
  return {
    cwd: deps.cwd ?? process.cwd(),
    git: deps.git ?? spawnRunner("git"),
    now: deps.now ?? Date.now,
    stderr: deps.stderr ?? process.stderr.write.bind(process.stderr),
    stdout: deps.stdout ?? process.stdout.write.bind(process.stdout),
  };
}

export async function main(argv: string[], deps: PushDeps = {}): Promise<number> {
  const io = filled(deps);
  const { cwd, git, stderr } = io;

  if (argv.length > 1 || argv.some((arg) => arg.startsWith("-"))) {
    stderr(`${USAGE}\n`);

    return EXIT_NO_BRANCH;
  }

  const [given] = argv;
  const target = given === undefined ? pickTarget(git, cwd, io.now()) : named(given);

  if (target.kind !== "branch") {
    const [line, code] = refusal(target);
    stderr(`repo push: ${line}\n`);

    return code;
  }

  const { branch } = target;
  const hasUpstream = git(gitUpstream(branch), cwd).code === 0;
  const pushed = inheritRunner("git")(["push", ...(hasUpstream ? [] : ["-u"]), REMOTE, branch], cwd);

  if (pushed.code !== 0) {
    const fix = "fix what the pre-push lines above name and run it again";
    stderr(`repo push: git push failed (exit ${pushed.code}); ${fix}\n`);

    return EXIT_REFUSED;
  }

  return await waitMain({ ...deps, ...io, branch });
}
