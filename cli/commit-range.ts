import type { CommitFacts, CommitMsgIo, CommitRules } from "./commit-msg.ts";
import { FULL_SHA, RANGE_SIDES, SHORT_SHA, ZERO_SHA } from "./commit-range.constants.ts";
import { commitChange } from "./staged-change.ts";
import { runGit } from "./sync/standards.ts";

/** The checker of one message, as `checkCommitMessage`. */
type Check = (message: string, facts: CommitFacts) => string[];

/** Whether git succeeds at `cwd` with `args`. */
const works = (cwd: string, ...args: string[]): boolean => runGit(cwd, args).status === 0;
/** The non-empty lines git prints at `cwd` with `args`; none when it fails. */
const linesOf = (cwd: string, ...args: string[]): string[] => runGit(cwd, args).stdout.split("\n").filter(Boolean);

/** The commits to check: those in `base..head` oldest first, or `head` alone, never a merge; null for an unknown range. */
function commitsOf({ base, head }: { base: string; head: string }, io: CommitMsgIo): string[] | null {
  const tip = head === "" ? "HEAD" : head;
  if (!works(io.cwd, "rev-parse", "--verify", `${tip}^{commit}`)) return null;
  const alone = () => linesOf(io.cwd, "rev-list", "--no-merges", "-n1", tip);
  if (base === "" || base === ZERO_SHA) return alone();
  const known = works(io.cwd, "rev-parse", "--verify", `${base}^{commit}`);
  if (!known && !FULL_SHA.test(base)) return null;
  if (known && works(io.cwd, "merge-base", "--is-ancestor", base, tip))
    return linesOf(io.cwd, "rev-list", "--reverse", "--no-merges", `${base}..${tip}`);

  io.stderr(
    `commit-msg: ${base.slice(0, SHORT_SHA)} is not an ancestor of HEAD (a force push?); checking HEAD alone\n`,
  );
  return alone();
}

/**
 * `repo commit-msg --range <base>..<head>`: checks each non-merge commit with `how.check` and `how.rules`, as the hook checks a
 * staged change, and prints `commit-msg: <sha7> <subject>: <problem>` per problem. Returns 1 when any, or the range is
 * unknown. A base that is zero, empty or not an ancestor of the head checks the head alone.
 */
export function commitRange(range: string, how: { rules: CommitRules; check: Check }, io: CommitMsgIo): number {
  const { rules, check } = how;
  const sides = range.split("..");
  // two sides are read only when the range has exactly two
  const [base, head] = sides /* two sides, or unused */ as [string, string];
  const shas = sides.length === RANGE_SIDES ? commitsOf({ base, head }, io) : null;
  if (shas === null) {
    io.stderr(`repo commit-msg: no commit range "${range}"; use <base>..<head>\n`);
    return 1;
  }
  let failed = false;
  for (const sha of shas) {
    const { files, changedLines } = commitChange(io.cwd, sha);
    const message = runGit(io.cwd, ["log", "-1", "--format=%B", sha]).stdout;
    const subject = runGit(io.cwd, ["log", "-1", "--format=%s", sha]).stdout.trim();
    for (const problem of check(message, { ...rules, changedLines, stagedFiles: files })) {
      io.stderr(`commit-msg: ${sha.slice(0, SHORT_SHA)} ${subject}: ${problem}\n`);
      failed = true;
    }
  }
  return failed ? 1 : 0;
}
