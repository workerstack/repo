/** The workflow guard tests' shared world: workflow reads, the shared-git call, the push deny text and a temp repo. */
import { afterEach, vi } from "vitest";

import type { WorkflowRead } from "../../workflow.ts";
import { sharedGitReason } from "../worktree-guards.ts";
import type { GuardEnv, ShellAt } from "../worktree.types.ts";
import { NONE, git, scratch, wt } from "./worktree-repo.ts";

/** The reads that keep the default branch for pull requests. */
export const STRICT: readonly WorkflowRead[] = ["pull-request", "unreadable"];

/** The grant words of a message that asks for a force push. */
export const FORCE: ReadonlySet<string> = new Set(["force"]);

const FINISH_ADVICE = "run bun repo worktree finish <name> to push wt/<name> and open its pull request";

/** A workflow read that answers `read`, its calls counted. */
export function reading(read: WorkflowRead) {
  return vi.fn<(root: string) => WorkflowRead>(() => read);
}

/** What one `sharedGitReason` call runs: the line, where, the grant words and any other guard swaps. */
type Line = { cmd: string; place: ShellAt; asked?: ReadonlySet<string>; more?: GuardEnv };

/** `sharedGitReason` for `line` under the workflow read `read`. */
export function sharedAs(read: WorkflowRead, { cmd, place, asked = NONE, more = {} }: Line): string | null {
  return sharedGitReason(cmd, { ...place, asked }, { workflow: reading(read), ...more });
}

/** The push deny text for `read` with default branch `main`. */
export function pushDeny(read: WorkflowRead): string {
  const why = read === "unreadable" ? "repo.config.ts failed to load" : `workflow is ${read}`;

  return `main takes changes only through pull requests (${why}): ${FINISH_ADVICE}`;
}

/** Per test file: temp repos removed after each test, and a maker of a repo with a worktree on it. */
export function useGuardRepos() {
  const tmp = scratch();

  afterEach(() => tmp.cleanup());

  /** A repo on main with a managed worktree `a` on `wt/a` and a branch `wt/x`. */
  function repoWithWorktree(): string {
    const r = tmp.repo();
    git(r, "worktree", "add", "-q", wt(r, "a"), "-b", "wt/a");
    git(r, "branch", "wt/x");

    return r;
  }

  return { repoWithWorktree, tmp };
}
