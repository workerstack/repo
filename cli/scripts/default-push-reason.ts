/** The default-branch push deny of a workflow that keeps the default branch for pull requests. */
import { rulesOf } from "../workflow.ts";
import { pushedRefs } from "./ci-push-parse.ts";
import { canonicalPath } from "./workspace-root.ts";
import { relIn } from "./worktree-git.ts";
import {
  defaultBranchPushReason,
  hitsUnresolved,
  shellQuoted,
  unresolvedPushReason,
} from "./worktree-guards.constants.ts";
import { PUSH_SUB } from "./worktree.constants.ts";
import type { GitCommand, SharedContext } from "./worktree.types.ts";

/**
 * The deny reason for the pushes in `commands` under the root when the workflow keeps the default branch for pull
 * requests and one sends or deletes it, `--all` or `--mirror`, else null; the workflow is read only when one exists.
 * A push word the shell sets only as it runs (`$B`, `"HEAD:$B"`) denies, since an unset one pushes the current
 * branch. The pushes are read back as one shell line, so a prefix or a heredoc never hides one; a throw while
 * resolving their refs denies.
 */
export function defaultPushReason(commands: GitCommand[], c: SharedContext): string | null {
  const { p, root } = c;
  const pushes = commands.filter((g) => g.sub === PUSH_SUB && relIn(canonicalPath(g.at, p), root, p) !== null);

  if (pushes.length === 0 || !c.committed() || rulesOf(c.read()).pushDefaultBranch) return null;
  const reason = defaultBranchPushReason(c.defaultBranch(), c.read());

  if (pushes.some((g) => hitsUnresolved(g.rest, c.defaultBranch()))) return reason;
  const unread = pushes.flatMap((g) => g.rest).find((w) => !w.literal);

  if (unread !== undefined) return unresolvedPushReason(unread.text, c.defaultBranch(), c.read());
  const words = pushes.map((g) => ["git", "-C", g.at, PUSH_SUB, ...g.rest.map((w) => w.text)].map(shellQuoted));

  try {
    const refs = pushedRefs(c.git, words.map((line) => line.join(" ")).join("\n"), root);

    return refs.some((ref) => ref.branch === c.defaultBranch()) ? reason : null;
  } catch {
    return reason;
  }
}
