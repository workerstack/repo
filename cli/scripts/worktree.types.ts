import type path from "node:path";

import type { Roots } from "./workspace-root.ts";

/** One git run: whether it exited 0, and its trimmed stdout and stderr. */
export interface GitRun {
  ok: boolean;
  out: string;
  err: string;
}

/** A linked worktree as `git worktree list --porcelain` names it. */
export interface WorktreeEntry {
  path: string;
  branch: string | null;
}

/** One `git worktree list` row with its state. */
export interface WorktreeInfo {
  path: string;
  branch: string | null;
  state: "clean" | "dirty" | "missing";
  merged: boolean;
  managed: boolean;
}

/** What `finishWorktree` landed; `sha` is null when the branch had no commits of its own. */
export interface FinishResult {
  branch: string;
  path: string;
  defaultBranch: string;
  sha: string | null;
}

/** What `pruneWorktrees` removed: a worktree and its branch, or a branch alone (`path` null). */
export interface Pruned {
  path: string | null;
  branch: string;
}

/** The hook outcome Claude Code reads: exit code, stdout and stderr. */
export interface HookResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** The roots a guard reads: `root` always, `checkout` and `cwd` when the caller has them. */
export type WorktreeRoots = Pick<Roots, "root"> & Partial<Pick<Roots, "checkout" | "cwd">>;

/** Where a shell line runs: the roots and the shell's cwd. */
export interface ShellAt {
  roots: WorktreeRoots;
  cwd: string;
}

/** A shell line's place plus the grant words (`GIT_ASKED`) the user's latest message named. */
export interface SharedAt extends ShellAt {
  asked: ReadonlySet<string>;
}

/** What a guard may swap for tests: the path flavor and the has-a-commit check. */
export interface GuardEnv {
  p?: typeof path;
  committed?: (root: string) => boolean;
}

/** One shell word and whether it is free of `$`, backticks and a leading `~`. */
export interface Word {
  text: string;
  literal: boolean;
}

/** A git command found in a shell line: the dir it runs in, its subcommand and the words after it. */
export interface GitCommand {
  at: string;
  sub: string;
  rest: Word[];
}

/** A parsed `git worktree add`. */
export interface WorktreeAdd {
  at: string;
  target: Word | null;
  branch: string | null;
  commitish: string | null;
  detach: boolean;
}

/** What a shared-git rule knows about where a command runs. */
export interface GitContext {
  p: typeof path;
  root: string;
  inMain: boolean;
  defaultBranch: () => string;
}

/** The deny reason one git subcommand earns, else null. */
export type SharedRule = (g: GitCommand, c: GitContext) => string | null;

/** A heredoc a line opened: its terminator word and whether `<<-` lets tabs lead it. */
export interface Heredoc {
  word: string;
  indented: boolean;
}

/** The shell lexer's place: the text, the index, the segments so far, the open segment and word. */
export interface ShellLexer {
  s: string;
  i: number;
  segments: Word[][];
  seg: Word[];
  word: Word | null;
}

/** A `finish` in progress: the root, the worktree dir, its branch and the default branch. */
export interface Finishing {
  root: string;
  dest: string;
  branch: string;
  target: string;
}
