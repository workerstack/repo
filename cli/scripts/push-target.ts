/**
 * The branch `repo push` pushes when none is named: the checked-out branch, or from the default branch its one recent
 * branch. Git only, so the PreToolUse push parser can load it on every command.
 */
import type { Runner } from "./ci-wait-run.ts";
import {
  CHECKOUT_MOVE,
  GIT_CURRENT,
  GIT_DEFAULT,
  GIT_HEADS,
  GIT_REFLOG,
  HEAD_LINE,
  MS_PER_SECOND,
  NEWEST_HEADS,
  RECENT_SECONDS,
  REMOTE_PREFIX,
} from "./push.constants.ts";
import { BRANCH_PREFIX } from "./worktree.constants.ts";

/**
 * What `repo push` pushes: a branch; or why not: the default has several recent branches to ask about, HEAD is a
 * managed worktree's branch or detached, or origin has no default branch.
 */
export type PushTarget =
  | { kind: "branch"; branch: string }
  | { kind: "ask"; base: string; branches: string[] }
  | { kind: "worktree"; branch: string; name: string }
  | { kind: "detached" }
  | { kind: "no-default" };

/**
 * The local branches other than `base` and the managed worktrees' that the last 30 checkouts or the 8 newest heads
 * name and that got a commit within a week of `now`, by name.
 */
function recentBranches(read: (args: string[]) => string, now: number, base: string): string[] {
  const heads = [...read(GIT_HEADS.slice()).matchAll(HEAD_LINE)].map((m) => ({
    date: Number(m.groups?.date),
    name: String(m.groups?.name),
  }));
  const since = now / MS_PER_SECOND - RECENT_SECONDS;
  const fresh = new Set(heads.filter((h) => h.date >= since).map((h) => h.name));
  const moves = [...read(GIT_REFLOG.slice()).matchAll(CHECKOUT_MOVE)].flatMap((m) => [
    String(m.groups?.from),
    String(m.groups?.to),
  ]);
  const named = new Set([...moves, ...heads.slice(0, NEWEST_HEADS).map((h) => h.name)]);
  return [...named].filter((n) => fresh.has(n) && n !== base && !n.startsWith(BRANCH_PREFIX)).toSorted();
}

/** The branch `repo push` with no branch named pushes from `cwd`, with commit ages measured from `now` (ms). */
export function pickTarget(git: Runner, cwd: string, now: number): PushTarget {
  const current = git(GIT_CURRENT.slice(), cwd);
  if (current.code !== 0) return { kind: "detached" };
  const branch = current.stdout.trim();
  if (branch.startsWith(BRANCH_PREFIX)) return { branch, kind: "worktree", name: branch.slice(BRANCH_PREFIX.length) };
  const origin = git(GIT_DEFAULT.slice(), cwd);
  if (origin.code !== 0) return { kind: "no-default" };
  const base = origin.stdout.trim().slice(REMOTE_PREFIX.length);
  if (branch !== base) return { branch, kind: "branch" };
  const [only = base, ...more] = recentBranches((args) => git(args, cwd).stdout, now, base);
  return more.length === 0 ? { branch: only, kind: "branch" } : { base, branches: [only, ...more], kind: "ask" };
}
