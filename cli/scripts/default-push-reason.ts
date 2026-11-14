/** The default-branch push deny of a workflow that keeps the default branch for pull requests. */
import { rulesOf } from "../workflow.ts";
import { pushRefs } from "./ci-push-parse.ts";
import type { ReadWord } from "./shell-ast.types.ts";
import { dirUnder } from "./worktree-git.ts";
import { defaultBranchPushReason, hitsUnresolved, UNREAD_PUSH, unreadPushReason } from "./worktree-guards.constants.ts";
import { HEADS_REF, PUSH_SUB } from "./worktree.constants.ts";
import type { GitCommand, GitLine, SharedContext, UnreadScript } from "./worktree.types.ts";

/** The index `at` reads as the last item. */
const LAST = -1;

/** What fills an unknown part of a push word that cannot send the default branch: no ref name holds it alone. */
const FILL = "_";

/** The names a push word's last unknown part may complete into the branch it sends with no `:`. */
function sourceNames(branch: string): string[] {
  return [branch, HEADS_REF + branch, "HEAD", "@"];
}

/**
 * True when an unknown push word may send `branch`: it starts with an unknown part (a remote, a whole refspec); or
 * the known text after its last unknown part ends one of `sourceNames`; or that text holds a `:` and names
 * `branch` (or nothing, the source's own name) after the last one.
 */
function canSendDefault({ pieces }: ReadWord, branch: string): boolean {
  const tail = String(pieces.at(LAST));

  if (pieces[0] === "") return true;

  if (!tail.includes(":")) return sourceNames(branch).some((name) => name.endsWith(tail));

  return ["", branch, HEADS_REF + branch].includes(tail.slice(tail.lastIndexOf(":") + 1));
}

/**
 * What the gate cannot read about the pushes and scripts of a line, as `UNREAD_PUSH` names it; null when it can. A
 * word with an unknown part counts only when that part may make it send `branch`.
 */
function unreadOf(pushes: readonly GitCommand[], scripts: readonly UnreadScript[], branch: string): string | null {
  for (const { at } of pushes) if (!at.known) return UNREAD_PUSH.dir(at.cause);
  const [script] = scripts;

  if (script !== undefined) return UNREAD_PUSH.script(script.cause);
  const word = pushes.flatMap((g) => g.rest).find((w) => !w.literal && canSendDefault(w, branch));

  return word === undefined ? null : UNREAD_PUSH.word(word.text);
}

/** A push word as `pushRefs` reads it: its text, or each unknown part filled, which then cannot send the branch. */
function pushText(w: ReadWord): string {
  return w.literal ? w.text : w.pieces.join(FILL);
}

/** True when a push sends the default branch, resolved where each runs; a throw while resolving counts as one. */
function sendsDefault(pushes: readonly GitCommand[], c: SharedContext): boolean {
  try {
    return pushes.some(
      ({ at, rest }) =>
        at.known && pushRefs(c.git, at.path, rest.map(pushText)).some((r) => r.branch === c.defaultBranch()),
    );
  } catch {
    return true;
  }
}

/**
 * The deny reason for the pushes of `line` under the root when the workflow keeps the default branch for pull
 * requests and one sends or deletes it, `--all` or `--mirror`, else null; the workflow is read only when a push or an
 * unread script exists. A push whose dir the shell sets only as it runs (`$D`), or a word whose unknown part may make
 * it send the default branch (`"HEAD:$B"`, `"wt/$N"`), denies, and so does a script a shell runs that the gate
 * cannot read.
 */
export function defaultPushReason(line: GitLine, c: SharedContext): string | null {
  const { p, root } = c;
  const pushes = line.commands.filter((g) => g.sub === PUSH_SUB && dirUnder(g.at, root, p) !== null);
  const scripts = line.unread.filter((s) => dirUnder(s.at, root, p) !== null);

  if (pushes.length === 0 && scripts.length === 0) return null;

  if (!c.committed() || rulesOf(c.read()).pushDefaultBranch) return null;
  const branch = c.defaultBranch();

  if (pushes.some((g) => hitsUnresolved(g.rest, branch))) return defaultBranchPushReason(branch, c.read());
  const unread = unreadOf(pushes, scripts, branch);

  if (unread !== null) return unreadPushReason(unread, branch, c.read());

  return sendsDefault(pushes, c) ? defaultBranchPushReason(branch, c.read()) : null;
}
