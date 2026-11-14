/** The default-branch push deny of a workflow that keeps the default branch for pull requests. */
import { rulesOf } from "../workflow.ts";
import { pushRefs } from "./ci-push-parse.ts";
import { dirUnder } from "./worktree-git.ts";
import { defaultBranchPushReason, hitsUnresolved, UNREAD_PUSH, unreadPushReason } from "./worktree-guards.constants.ts";
import { PUSH_SUB } from "./worktree.constants.ts";
import type { GitCommand, GitLine, SharedContext, UnreadScript } from "./worktree.types.ts";

/** What the gate cannot read about the pushes and scripts of a line, as `UNREAD_PUSH` names it; null when it can. */
function unreadOf(pushes: readonly GitCommand[], scripts: readonly UnreadScript[]): string | null {
  for (const { at } of pushes) if (!at.known) return UNREAD_PUSH.dir(at.cause);
  const [script] = scripts;

  if (script !== undefined) return UNREAD_PUSH.script(script.cause);
  const word = pushes.flatMap((g) => g.rest).find((w) => !w.literal);

  return word === undefined ? null : UNREAD_PUSH.word(word.text);
}

/** True when a push sends the default branch, resolved where each runs; a throw while resolving counts as one. */
function sendsDefault(pushes: readonly GitCommand[], c: SharedContext): boolean {
  try {
    return pushes.some(
      ({ at, rest }) =>
        at.known &&
        pushRefs(
          c.git,
          at.path,
          rest.map((w) => w.text),
        ).some((r) => r.branch === c.defaultBranch()),
    );
  } catch {
    return true;
  }
}

/**
 * The deny reason for the pushes of `line` under the root when the workflow keeps the default branch for pull
 * requests and one sends or deletes it, `--all` or `--mirror`, else null; the workflow is read only when a push or an
 * unread script exists. A push whose dir or word the shell sets only as it runs (`$D`, `"HEAD:$B"`) denies, and so
 * does a script a shell runs that the gate cannot read, since either may push the default branch.
 */
export function defaultPushReason(line: GitLine, c: SharedContext): string | null {
  const { p, root } = c;
  const pushes = line.commands.filter((g) => g.sub === PUSH_SUB && dirUnder(g.at, root, p) !== null);
  const scripts = line.unread.filter((s) => dirUnder(s.at, root, p) !== null);

  if (pushes.length === 0 && scripts.length === 0) return null;

  if (!c.committed() || rulesOf(c.read()).pushDefaultBranch) return null;
  const branch = c.defaultBranch();

  if (pushes.some((g) => hitsUnresolved(g.rest, branch))) return defaultBranchPushReason(branch, c.read());
  const unread = unreadOf(pushes, scripts);

  if (unread !== null) return unreadPushReason(unread, branch, c.read());

  return sendsDefault(pushes, c) ? defaultBranchPushReason(branch, c.read()) : null;
}
