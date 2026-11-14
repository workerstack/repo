import type path from "node:path";

import type { WorkflowRead } from "../workflow.ts";
import type { Runner } from "./ci-wait-run.ts";
import type { Roots } from "./workspace-root.ts";

/** One git run: whether it exited 0, and its trimmed stdout and stderr. */
export type GitRun = {
  ok: boolean;
  out: string;
  err: string;
};

/** A linked worktree as `git worktree list --porcelain` names it. */
export type WorktreeEntry = {
  path: string;
  branch: string | null;
};

/** One `git worktree list` row with its state. */
export type WorktreeInfo = {
  path: string;
  branch: string | null;
  state: "clean" | "dirty" | "missing";
  merged: boolean;
  managed: boolean;
};

/** What a local `finishWorktree` landed; `sha` is null when the branch had no commits of its own. */
export type LocalFinish = {
  branch: string;
  path: string;
  defaultBranch: string;
  sha: string | null;
};

/** A pull request's state as gh names it. */
export type PrState = "OPEN" | "MERGED" | "CLOSED";

/** A branch's newest pull request: its state, URL, number and head commit (gh's `headRefOid`). */
export type PullRequest = {
  state: PrState;
  url: string;
  number: number;
  head: string;
};

/**
 * What a pull-request `finishWorktree` did: pushed the branch at `sha` and opened its pull request at `url` or updated
 * it, or landed the merged one with the default branch now at `sha`.
 */
export type PullRequestFinish = Omit<LocalFinish, "sha"> & {
  kind: "opened" | "updated" | "landed";
  url: string;
  sha: string;
};

/** What `finishWorktree` did: a local finish carries no `kind`, a pull-request one does. */
export type FinishResult = LocalFinish | PullRequestFinish;

/** What `finishWorktree` may swap for tests: the gh it asks about pull requests, and the workflow read. */
export type FinishDeps = {
  gh?: Runner;
  workflow?: (root: string) => WorkflowRead;
};

/** What `pruneWorktrees` removed: a worktree and its branch, or a branch alone (`path` null). */
export type Pruned = {
  path: string | null;
  branch: string;
};

/** The hook outcome Claude Code reads: exit code, stdout and stderr. */
export type HookResult = {
  code: number;
  stdout: string;
  stderr: string;
};

/** The roots a guard reads: `root` always, `checkout` and `cwd` when the caller has them. */
export type WorktreeRoots = Pick<Roots, "root"> & Partial<Pick<Roots, "checkout" | "cwd">>;

/** Where a shell line runs: the roots and the shell's cwd. */
export type ShellAt = {
  roots: WorktreeRoots;
  cwd: string;
};

/** A shell line's place plus the grant words (`GIT_ASKED`) the user's latest message named. */
export type SharedAt = {
  asked: ReadonlySet<string>;
} & ShellAt;

/** What a guard may swap for tests: the path flavor, the has-a-commit check, the workflow read and the push's git. */
export type GuardEnv = {
  p?: typeof path;
  committed?: (root: string) => boolean;
  /** The workflow the root's repo.config.ts names; read only on a path that would deny without it. */
  workflow?: (root: string) => WorkflowRead;
  /** The git the default-branch push check resolves pushed refs with. */
  git?: Runner;
};

/** One shell word and whether it is free of `$`, backticks and a leading `~`. */
export type Word = {
  text: string;
  literal: boolean;
};

/** A git command found in a shell line: the dir it runs in, its subcommand and the words after it. */
export type GitCommand = {
  at: string;
  sub: string;
  rest: Word[];
};

/** A parsed `git worktree add`. */
export type WorktreeAdd = {
  at: string;
  target: Word | null;
  branch: string | null;
  commitish: string | null;
  detach: boolean;
};

/** What a shared-git rule knows about where a command runs. */
export type GitContext = {
  p: typeof path;
  root: string;
  inMain: boolean;
  defaultBranch: () => string;
  /** Whether the workflow lets the main checkout take writes and commits, read on first ask. */
  mainWrites: () => boolean;
};

/**
 * What `sharedGitReason` knows about the root before a command's place is known: the rule context, the has-a-commit
 * check, the workflow read and the git the push check resolves refs with.
 */
export type SharedContext = Omit<GitContext, "inMain"> & {
  committed: () => boolean;
  read: () => WorkflowRead;
  git: Runner;
};

/** The deny reason one git subcommand earns, else null. */
export type SharedRule = (g: GitCommand, c: GitContext) => string | null;

/** A heredoc a line opened: its terminator word and whether `<<-` lets tabs lead it. */
export type Heredoc = {
  word: string;
  indented: boolean;
};

/** The shell lexer's place: the text, the index, the segments so far, the open segment and word. */
export type ShellLexer = {
  s: string;
  i: number;
  segments: Word[][];
  seg: Word[];
  word: Word | null;
};

/** A `finish` in progress: the root, the worktree dir, its branch and the default branch. */
export type Finishing = {
  root: string;
  dest: string;
  branch: string;
  target: string;
};
