import fs from "node:fs";

import {
  AMEND,
  ARGV_END,
  COMMIT,
  COMMIT_VALUED,
  GIT_NAMES,
  GLOBAL_VALUED,
  INIT_PID,
  MAX_DEPTH,
  PATH_SEPARATORS,
  WITH_VALUE,
} from "./commit-amend.constants.ts";
import type { ProofBase } from "./red-proof.ts";
import { type GitRun, runGit } from "./sync/standards.ts";

/**
 * Whether the commit-msg hook runs for `git commit --amend`. Git tells a hook nothing about it, so this reads the argv
 * of the git process above the hook from `/proc`. Where there is no `/proc` (macOS, Windows) every commit reads as
 * plain, which judges it as before.
 */

/** One process as `/proc` shows it: its parent and its argv. */
export type Proc = { ppid: number; argv: string[] };

/** What a commit is judged against: `diff` for the index diff (undefined: git's own, HEAD or nothing) and `proof`. */
export type Base = { diff: string | undefined; proof: ProofBase };

/** A plain commit's base: the index against HEAD, red-proof on HEAD's source. */
export const PLAIN_BASE: Base = { diff: undefined, proof: "HEAD" };

/** Process `pid` from `/proc/<pid>/stat` and `/proc/<pid>/cmdline`, or null when it cannot be read. */
export function readProc(pid: number): Proc | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");

    // The name in parentheses may hold spaces and `)`; the fields after the last `)` are state, then ppid.
    const ppid = Number(
      stat
        .slice(stat.lastIndexOf(")") + 1)
        .trim()
        .split(" ")[1],
    );

    const argv = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").slice(0, ARGV_END);

    return { argv, ppid };
  } catch {
    return null;
  }
}

/** Whether git's argv (after `git`) is a `commit` that amends: the last `--amend` or `--no-amend` before `--` wins. */
export function commitAmends(argv: readonly string[]): boolean {
  let at = 0;

  for (let token = argv[at]; token?.startsWith("-") === true; token = argv[at])
    at += GLOBAL_VALUED.includes(token) ? WITH_VALUE : 1;

  if (argv[at] !== COMMIT) return false;
  let isAmend = false;

  for (let token = argv[++at]; token !== undefined && token !== "--"; token = argv[++at]) {
    const amend = AMEND.exec(token);

    if (amend !== null) isAmend = amend[1] === undefined;
    else if (COMMIT_VALUED.includes(token)) at++;
  }

  return isAmend;
}

/** Whether `file` names git, cut on `/` and `\`. */
function isGit(file: string | undefined): boolean {
  return GIT_NAMES.includes(file?.split(PATH_SEPARATORS).pop() ?? "");
}

/** Whether the nearest git above `start` (the hook's parent) runs an amending `git commit`. */
export function amending(start: number = process.ppid, read: (pid: number) => Proc | null = readProc): boolean {
  let pid = start;

  for (let depth = 0; depth < MAX_DEPTH && pid > INIT_PID; depth++) {
    const proc = read(pid);

    if (proc === null) return false;

    if (isGit(proc.argv[0])) return commitAmends(proc.argv.slice(1));
    pid = proc.ppid;
  }

  return false;
}

/**
 * An amend's base: the index against HEAD's parent, or against the empty tree when HEAD is a root commit; red-proof
 * runs on `HEAD^`, and skips when there is none.
 */
export function amendBase(root: string, git: GitRun = runGit): Base {
  if (git(root, ["rev-parse", "--verify", "--quiet", "HEAD^"]).status === 0) return { diff: "HEAD^", proof: "HEAD^" };
  const empty = git(root, ["hash-object", "-t", "tree", "--stdin"], "").stdout.trim();

  return { diff: empty, proof: "HEAD^" };
}
