import type { Runner } from "../scripts/ci-wait.ts";
import { gitFailed } from "./release-messages.constants.ts";
import {
  BARE_TAG_OF,
  COMMIT_END,
  COMMIT_SEPARATOR,
  GIT_AHEAD_BEHIND,
  GIT_COMMITS,
  GIT_COMMITS_AFTER,
  GIT_ORIGIN_HEAD,
  GIT_RELEASE_LOG,
  GIT_TAG_REF,
  MAIN_FALLBACK,
  ORIGIN_HEAD_PREFIX,
  TAG_OF,
} from "./release.constants.ts";
import type { Commit } from "./version.ts";

const WHITESPACE = /\s+/;

/** The checkout `repo release` works in, and the git and gh it runs there. */
export type Tools = { cwd: string; git: Runner; gh: Runner };

/** What git prints for `args`, trimmed; empty when it fails. */
export function read(t: Tools, args: readonly string[]): string {
  return t.git([...args], t.cwd).stdout.trim();
}

/** Runs git with `args` and throws a line naming the failure; the flow's boundary prints it. */
export function must(t: Tools, args: readonly string[]): string {
  const got = t.git([...args], t.cwd);

  if (got.code !== 0)
    throw new Error(gitFailed(args[0] /* every git call here names a subcommand */ as string, got.stderr.trim()));

  return got.stdout.trim();
}

/** The default branch: what origin's HEAD names, else main. */
export function defaultBranch(t: Tools): string {
  const ref = read(t, GIT_ORIGIN_HEAD);

  return ref.startsWith(ORIGIN_HEAD_PREFIX) ? ref.slice(ORIGIN_HEAD_PREFIX.length) : MAIN_FALLBACK;
}

/** How many commits a branch is ahead of and behind its upstream. */
type Divergence = { ahead: number; behind: number };

/** How many commits `branch` is ahead of and behind origin's. */
export function divergence(t: Tools, branch: string): Divergence {
  const [ahead, behind] = read(t, GIT_AHEAD_BEHIND(branch)).split(WHITESPACE);

  return { ahead: Number(ahead), behind: Number(behind) };
}

/** The tag that marks `version` as released, `<name>@<version>` or `v<version>`; null when neither exists. */
export function releaseTag(t: Tools, name: string, version: string): string | null {
  return [TAG_OF(name, version), BARE_TAG_OF(version)].find((tag) => read(t, GIT_TAG_REF(tag)) !== "") ?? null;
}

/** What may follow a release subject: nothing, or the ` (#<n>)` GitHub adds to a squash-merged pull request's. */
const PULL_REQUEST_SUFFIX = /^(?: \(#\d+\))?$/;

/** Whether `found` is `subject`, or `subject (#<n>)` as a squash merge names it. */
function isSubject(found: string, subject: string): boolean {
  return found.startsWith(subject) && PULL_REQUEST_SUFFIX.test(found.slice(subject.length));
}

/**
 * The sha of the newest commit in HEAD's history whose subject is `subject`, or `subject (#<n>)` as a squash merge
 * names it; null when there is none.
 */
export function commitWithSubject(t: Tools, subject: string): string | null {
  const lines = read(t, GIT_RELEASE_LOG(subject)).split("\n");
  const hit = lines.map((line) => line.split("\t")).find(([, found = ""]) => isSubject(found, subject));

  return hit?.[0] ?? null;
}

/** The commits a `git log` printed in `GIT_COMMITS`' format, newest first. */
function parseCommits(log: string): Commit[] {
  return log
    .split(COMMIT_END)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const at = entry.indexOf(COMMIT_SEPARATOR);

      return { body: entry.slice(at + 1), subject: entry.slice(0, at) };
    });
}

/** The commits after `since` (every commit when null), newest first. */
export function commitsSince(t: Tools, since: string | null): Commit[] {
  return parseCommits(read(t, GIT_COMMITS(since)));
}

/** The commits dated after `since` (an ISO time) that touch `dir`, newest first; a commit elsewhere is not counted. */
export function commitsAfter(t: Tools, after: { since: string; dir: string }): Commit[] {
  return parseCommits(read(t, GIT_COMMITS_AFTER(after.since, after.dir)));
}
