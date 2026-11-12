import type { CommitFacts, CommitMsgIo, CommitRules } from "./commit-msg.ts";
import {
  FIELD_GAP,
  FULL_SHA,
  NO_OBJECT,
  OBJECT_NAME,
  PRE_PUSH_FLAG,
  PRE_PUSH_MAX_ARGS,
  PRE_PUSH_MIN_ARGS,
  RANGE_ARGS,
  RANGE_FLAG,
  RANGE_SIDES,
  REF_LINE_FIELDS,
  SHORT_SHA,
  ZERO_SHA,
} from "./commit-range.constants.ts";
import { commitChange } from "./staged-change.ts";
import { runGit } from "./sync/standards.ts";

/** The checker of one message, as `checkCommitMessage`. */
type Check = (message: string, facts: CommitFacts) => string[];

/** How each commit is judged: the repo's rules and the message check. */
type How = { rules: CommitRules; check: Check };

/** One ref a push sends, from a line of git's pre-push stdin; an all-zero sha names no commit on that side. */
type PushedRef = { localSha: string; remoteSha: string };

/** The source `repo commit-msg` checks: a message file, a range, or the commits a push to a remote sends. */
export type Source =
  | { kind: "file"; file: string }
  | { kind: "range"; range: string }
  | { kind: "push"; remote: string };

/** The source `argv` names, or null when it names none. */
export function sourceOf(argv: readonly string[]): Source | null {
  const [first, second] = argv;

  if (first === undefined) return null;

  if (first === RANGE_FLAG)
    return argv.length === RANGE_ARGS && second !== undefined ? { kind: "range", range: second } : null;

  if (first === PRE_PUSH_FLAG) {
    const fits = argv.length >= PRE_PUSH_MIN_ARGS && argv.length <= PRE_PUSH_MAX_ARGS;

    return fits && second !== undefined ? { kind: "push", remote: second } : null;
  }

  return argv.length === 1 ? { file: first, kind: "file" } : null;
}

/** Whether git succeeds at `cwd` with `args`. */
function works(cwd: string, ...args: string[]): boolean {
  return runGit(cwd, args).status === 0;
}

/** The non-empty lines git prints at `cwd` with `args`; none when it fails. */
function linesOf(cwd: string, ...args: string[]): string[] {
  return runGit(cwd, args).stdout.split("\n").filter(Boolean);
}

/**
 * The commits to check: those in `base..head` oldest first, or `head` alone, never a merge; null for an unknown
 * range.
 */
function commitsOf({ base, head }: { base: string; head: string }, io: CommitMsgIo): string[] | null {
  const tip = head === "" ? "HEAD" : head;

  if (!works(io.cwd, "rev-parse", "--verify", `${tip}^{commit}`)) return null;

  function alone() {
    return linesOf(io.cwd, "rev-list", "--no-merges", "-n1", tip);
  }

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

/** Checks each commit of `shas` with `how`, printing `commit-msg: <sha7> <subject>: <problem>`; 1 when any fails. */
function checkCommits(shas: readonly string[], { rules, check }: How, io: CommitMsgIo): number {
  let isFailed = false;

  for (const sha of shas) {
    const { files, changedLines } = commitChange(io.cwd, sha);
    const message = runGit(io.cwd, ["log", "-1", "--format=%B", sha]).stdout;
    const subject = runGit(io.cwd, ["log", "-1", "--format=%s", sha]).stdout.trim();

    for (const problem of check(message, { ...rules, changedLines, stagedFiles: files })) {
      io.stderr(`commit-msg: ${sha.slice(0, SHORT_SHA)} ${subject}: ${problem}\n`);
      isFailed = true;
    }
  }

  return isFailed ? 1 : 0;
}

/**
 * `repo commit-msg --range <base>..<head>`: checks each non-merge commit with `how.check` and `how.rules`, as the hook
 * checks a staged change, and prints `commit-msg: <sha7> <subject>: <problem>` per problem. Returns 1 when any, or
 * the range is unknown. A base that is zero, empty or not an ancestor of the head checks the head alone.
 */
export function commitRange(range: string, how: How, io: CommitMsgIo): number {
  const sides = range.split("..");
  // two sides are read only when the range has exactly two
  const [base, head] = sides /* two sides, or unused */ as [string, string];
  const shas = sides.length === RANGE_SIDES ? commitsOf({ base, head }, io) : null;

  if (shas === null) {
    io.stderr(`repo commit-msg: no commit range "${range}"; use <base>..<head>\n`);

    return 1;
  }

  return checkCommits(shas, how, io);
}

/**
 * The refs of git's pre-push stdin, each line trimmed (Windows ends them in CRLF), or the first line that is not one.
 */
function pushedRefs(input: string): PushedRef[] | { unreadable: string } {
  const refs: PushedRef[] = [];

  for (const raw of input.split("\n")) {
    const line = raw.trim();

    if (line === "") continue;
    const fields = line.split(FIELD_GAP);
    const [, localSha = "", , remoteSha = ""] = fields;

    if (fields.length !== REF_LINE_FIELDS || !OBJECT_NAME.test(localSha) || !OBJECT_NAME.test(remoteSha))
      return { unreadable: line };
    refs.push({ localSha, remoteSha });
  }

  return refs;
}

/**
 * The commits one pushed ref sends, oldest first and no merges: none for a delete; `<remote sha>..<local sha>` for a
 * ref the remote has; for a new ref every commit no ref of `remote` holds, so a branch's earlier commits count too.
 */
function sentCommits(remote: string, ref: PushedRef, io: CommitMsgIo): string[] | null {
  if (NO_OBJECT.test(ref.localSha)) return [];

  if (NO_OBJECT.test(ref.remoteSha))
    return linesOf(io.cwd, "rev-list", "--reverse", "--no-merges", ref.localSha, "--not", `--remotes=${remote}`);

  return commitsOf({ base: ref.remoteSha, head: ref.localSha }, io);
}

/**
 * `repo commit-msg --pre-push <remote>`: reads git's pre-push ref lines from `push.input` and checks every commit the
 * push sends to `push.remote` as `--range` does, each once. Returns 1 when any commit fails or a line or commit does
 * not read.
 */
export function commitPush(push: { remote: string; input: string }, how: How, io: CommitMsgIo): number {
  const { remote, input } = push;
  const refs = pushedRefs(input);

  if (!Array.isArray(refs)) {
    io.stderr(
      `repo commit-msg: unreadable pre-push line "${refs.unreadable}"; ` +
        "want <local ref> <local sha> <remote ref> <remote sha>\n",
    );

    return 1;
  }

  const shas = new Set<string>();

  for (const ref of refs) {
    const sent = sentCommits(remote, ref, io);

    if (sent === null) {
      io.stderr(`repo commit-msg: no commit range "${ref.remoteSha}..${ref.localSha}"\n`);

      return 1;
    }

    for (const sha of sent) shas.add(sha);
  }

  return checkCommits([...shas], how, io);
}
