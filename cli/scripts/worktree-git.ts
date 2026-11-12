import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { canonicalPath } from "./workspace-root.ts";
import { HEADS_REF, NO_BRANCH, WORKTREES_DIR } from "./worktree.constants.ts";
import type { GitRun, WorktreeEntry } from "./worktree.types.ts";

const UNSAFE_NAME_CHARS = /[^A-Za-z0-9._-]/g;
const DASH_RUNS = /-+/g;
const LEADING_DOTS_DASHES = /^[.-]+/;
const TRAILING_DASHES = /-+$/;
const BLANK_LINE_RUN = /\n\n+/;
const ORIGIN_PREFIX = /^origin\//;
const LEADING_SPACE = /^\s/;
const NOTHING: readonly unknown[] = [undefined, null];

/** `String(raw)`, or "" for undefined and null. */
export function textOf(raw: unknown): string {
  return NOTHING.includes(raw) ? "" : String(raw);
}

/** A spawn stream trimmed; empty when the spawn left none. */
function trimmed(stream: string | null | undefined): string {
  return stream?.trim() ?? "";
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function git(cwd: string, args: string[]): GitRun {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });

  return { err: trimmed(r.stderr), ok: r.status === 0, out: trimmed(r.stdout) };
}

export function samePath(a: string, b: string): boolean {
  return canonicalPath(path.resolve(a)) === canonicalPath(path.resolve(b));
}

/** A git-safe directory and branch name, or null when nothing usable is left. */
export function worktreeName(raw: unknown): string | null {
  const name = textOf(raw)
    .replaceAll(UNSAFE_NAME_CHARS, "-")
    .replaceAll(DASH_RUNS, "-")
    .replace(LEADING_DOTS_DASHES, "")
    .replace(TRAILING_DASHES, "");

  return name === "" ? null : name;
}

/** `worktreeName(raw)`, or a throw naming the characters a name may use. */
export function requireName(raw: unknown): string {
  const name = worktreeName(raw);
  const problem = `has no usable characters; use letters, digits, ".", "_" or "-"`;

  if (name === null) throw new Error(`worktree name "${textOf(raw)}" ${problem}`);

  return name;
}

/** True when `file` is a direct child of `<root>/.worktrees`, however git spells the path. */
export function isManaged(file: string, root: string, p: typeof path = path): boolean {
  const rel = p.relative(p.resolve(root, WORKTREES_DIR), p.resolve(file));

  return rel !== "" && !rel.startsWith("..") && !p.isAbsolute(rel) && !rel.includes(p.sep);
}

/** `abs` relative to `dir` (`""` for `dir` itself), or null when `abs` is outside it. */
export function relIn(abs: string, dir: string, p: typeof path): string | null {
  const rel = p.relative(dir, abs);

  return rel === ".." || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel) ? null : rel;
}

/** The `<name>` of the managed worktree under `root` that holds `abs`, else null. */
export function worktreeOf(abs: string, root: string, p: typeof path): string | null {
  const rel = relIn(abs, p.join(root, WORKTREES_DIR), p);

  return rel === null || rel === "" ? null : rel.split(p.sep, 1).join("");
}

export function hasCommit(root: string): boolean {
  return git(root, ["rev-parse", "--verify", "-q", "HEAD"]).ok;
}

/** `git worktree list --porcelain`, main checkout first. */
export function worktreeEntries(root: string): WorktreeEntry[] {
  const r = git(root, ["worktree", "list", "--porcelain"]);

  if (!r.ok) return [];

  return r.out.split(BLANK_LINE_RUN).map((block): WorktreeEntry => {
    // git opens every block with its `worktree <path>` line.
    const wt = block.split("\n", 1).join("");
    const branch = block.split("\n").find((l) => l.startsWith("branch "));

    return {
      branch: branch === undefined ? null : branch.slice(`branch ${HEADS_REF}`.length),
      path: canonicalPath(path.resolve(wt.slice("worktree ".length))),
    };
  });
}

/** The worktree git lists at `dest`; one whose dir is gone is pruned and counts as none. */
export function liveEntry(root: string, dest: string): WorktreeEntry | undefined {
  const entry = worktreeEntries(root)
    .slice(1)
    .find((e) => samePath(e.path, dest));

  if (entry === undefined || fs.existsSync(dest)) return entry;
  git(root, ["worktree", "prune"]);

  return undefined;
}

export function branchExists(root: string, branch: string): boolean {
  return git(root, ["show-ref", "--verify", "-q", HEADS_REF + branch]).ok;
}

/**
 * The shared default branch, never just whatever the main checkout has out: `origin/HEAD`'s branch, else
 * `init.defaultBranch`, else `main`, else `master` (each only when it exists locally), else the main checkout's current
 * branch, else "HEAD".
 */
export function defaultBranch(root: string): string {
  const remote = git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const configured = git(root, ["config", "--get", "init.defaultBranch"]);

  const named = [
    remote.ok ? remote.out.replace(ORIGIN_PREFIX, "") : "",
    configured.ok ? configured.out : "",
    "main",
    "master",
  ];

  const found = named.find((b) => b !== "" && branchExists(root, b));

  if (found !== undefined) return found;
  const head = git(root, ["symbolic-ref", "--short", "HEAD"]);

  return head.ok ? head.out : NO_BRANCH;
}

export function isMerged(root: string, branch: string): boolean {
  return git(root, ["merge-base", "--is-ancestor", HEADS_REF + branch, defaultBranch(root)]).ok;
}

/** The branch moved after it was created; no reflog counts as no, so a fresh worktree is never pruned. */
export function hasOwnCommits(root: string, branch: string): boolean {
  const r = git(root, ["reflog", "show", "--format=%gs", HEADS_REF + branch]);

  return r.ok && r.out.split("\n").some((l) => l !== "" && !l.startsWith("branch: Created from"));
}

/** git's first message plus its indented detail lines, on one line. */
export function gitReason(err: string): string {
  const lines = err.split("\n");
  const detail: string[] = [];

  for (const line of lines.slice(1)) {
    if (!LEADING_SPACE.test(line)) break;
    detail.push(line.trim());
  }

  // split always yields a first line; a git that failed always said why.
  return [lines[0], ...detail].join(" ");
}

export function rebaseInProgress(dir: string): boolean {
  const gitDir = git(dir, ["rev-parse", "--path-format=absolute", "--git-dir"]);

  return gitDir.ok && ["rebase-merge", "rebase-apply"].some((d) => fs.existsSync(path.join(gitDir.out, d)));
}

export function tipOf(root: string, branch: string): string {
  return git(root, ["rev-parse", "--verify", "-q", HEADS_REF + branch]).out;
}

/**
 * Move `target` to `branch`'s tip with a fast-forward only: in the root when it has `target` checked out, else
 * through the ref.
 */
export function fastForward(root: string, branch: string, target: string): GitRun {
  const source = HEADS_REF + branch;
  const isCheckedOut = git(root, ["symbolic-ref", "--short", "HEAD"]).out === target;

  return isCheckedOut
    ? git(root, ["merge", "--ff-only", source])
    : git(root, ["fetch", ".", `${source}:${HEADS_REF}${target}`]);
}

/** Rebase the worktree onto `target`; on failure abort it and throw the conflict line or git's reason. */
export function rebaseOnto(dest: string, branch: string, target: string): void {
  const rebased = git(dest, ["rebase", target]);

  if (rebased.ok) return;
  const files = git(dest, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
  git(dest, ["rebase", "--abort"]);

  if (files.length === 0) throw new Error(`rebasing ${branch} onto ${target} failed: ${gitReason(rebased.err)}`);
  throw new Error(
    `rebasing ${branch} onto ${target} conflicts in ${files.join(", ")}: run git -C ${dest} rebase ${target}, ` +
      `fix each file, git -C ${dest} add <file>, git -C ${dest} rebase --continue, rerun the checks, ` +
      "then run finish again",
  );
}
