/**
 * Reads the `git push`, `repo push` and pull-request `repo worktree finish` forms out of a shell command: where each
 * runs, and which branch and commit it names.
 */
import type path from "node:path";

import { readWorkflow } from "../workflow.ts";
import { HEAD, PUSH } from "./ci-push-parse.constants.ts";
import { recordRoot } from "./ci-wait-record.ts";
import type { Runner } from "./ci-wait-run.ts";
import { commandAt } from "./command-at.ts";
import { pickTarget } from "./push-target.ts";
import { BUN, REPO } from "./push.constants.ts";
import type { ReadWord, Scope, Simple, Visited } from "./shell-ast.types.ts";
import { readWord } from "./shell-fields.ts";
import { shellFlow } from "./shell-flow.ts";
import { processEnv } from "./shell-vars.ts";
import { canonicalPath } from "./workspace-root.ts";
import { worktreeName } from "./worktree-git.ts";
import { gitCommandOf } from "./worktree-shell.ts";
import { BRANCH_PREFIX, FINISH_CMD, WORKTREE_SUB } from "./worktree.constants.ts";

const HEADS = "refs/heads/";
const FORCE_PREFIX = /^\+/;

/** The `heads/` a destination may start with, which git reads as `refs/heads/`. */
const SHORT_HEADS = /^heads\//;

/**
 * One ref a push names: the branch it updates, the ref it sends, the commit that ref is now, and the directory it runs
 * in.
 */
export type PushedRef = { branch: string; src: string; sha: string; dir: string };

type Push = { dir: string; refs: string[] };

/** What reads a push: the git runner, and the path module of the host the command runs on. */
type Host = { git: Runner; p: typeof path };

/** The refspecs among the words after `push`: every word past the remote that is not a flag. */
function specsOf(rest: readonly string[]): string[] {
  return rest.filter((w) => !w.startsWith("-")).slice(1);
}

/** The refspecs of a `git push` the walk read: one with an unknown part as `HEAD`, the push it may be. */
function walkedSpecs(rest: readonly ReadWord[]): string[] {
  const known = rest.map((w) => (w.literal ? w.text : HEAD));

  return specsOf(known);
}

/**
 * The push in `[bun] repo push [<branch>]` from `dir`: the branch named, else the one `repo push` picks; null for any
 * other command, and when `repo push` would push nothing.
 */
function parseRepoPush(git: Runner, words: string[], dir: string): Push | null {
  const [bin, verb, named] = words[0] === BUN ? words.slice(1) : words;

  if (bin !== REPO || verb !== PUSH) return null;

  if (named !== undefined) return { dir, refs: [named] };
  const target = pickTarget(git, dir, Date.now());

  return target.kind === "branch" ? { dir, refs: [target.branch] } : null;
}

/**
 * The push in `[bun] repo worktree finish [<name>]` from `dir` when the main root's workflow is pull-request, where
 * finish pushes `wt/<name>`: the name given, else the `wt/` branch `dir` has out; null otherwise. It resolves in the
 * main root, which outlives the worktree a landed finish removes.
 */
function parseFinish(git: Runner, words: string[], dir: string): Push | null {
  const [bin, verb, sub, named] = words[0] === BUN ? words.slice(1) : words;

  if (bin !== REPO || verb !== WORKTREE_SUB || sub !== FINISH_CMD) return null;
  const root = canonicalPath(recordRoot(git, dir));

  if (readWorkflow(root) !== "pull-request") return null;
  const name = named === undefined ? null : worktreeName(named);
  const branch = name === null ? git(["rev-parse", "--abbrev-ref", HEAD], dir).stdout.trim() : BRANCH_PREFIX + name;

  return branch.startsWith(BRANCH_PREFIX) ? { dir: root, refs: [branch] } : null;
}

/** The push in a `repo` command line: `repo push`, or `repo worktree finish` under pull-request; null for others. */
function parseRepo(git: Runner, words: string[], dir: string): Push | null {
  return parseRepoPush(git, words, dir) ?? parseFinish(git, words, dir);
}

/**
 * The push one visited command makes: a `git push` where git runs, a `repo` push form where the program runs, or for a
 * script the gate cannot read, `HEAD` of its dir, the push it may make; null for any other command and an unknown dir.
 */
function pushOf(c: Host, v: Visited): Push | null {
  if (v.kind === "opaque") return v.dir.known ? { dir: v.dir.path, refs: [HEAD] } : null;

  return v.data === undefined ? commandPush(c, v) : null;
}

/** The push of a command the walk read: git's in the dir git runs in, else a `repo` form's in the run dir. */
function commandPush(c: Host, v: Simple & Scope): Push | null {
  const g = gitCommandOf(v.words, v, c.p);

  if (g !== null) return g.sub === PUSH && g.at.known ? { dir: g.at.path, refs: walkedSpecs(g.rest) } : null;
  const words = v.words.slice(commandAt(v.words)).map((w) => readWord(w).text);

  return v.dir.known ? parseRepo(c.git, words, v.dir.path) : null;
}

/**
 * Every `git push`, `repo push` and pull-request `repo worktree finish` in a shell command, each with the dir it runs
 * in, read from the shared bash walk.
 */
function pushesIn(c: Host, command: string, cwd: string): Push[] {
  const found: Push[] = [];

  shellFlow(command, { cwd, env: processEnv(), p: c.p }, (v) => {
    const push = pushOf(c, v);

    if (push !== null) found.push(push);
  });

  return found;
}

/** Git's full name for `name` in `dir`: `refs/heads/main` for `@`, or `HEAD` for a detached HEAD. */
function fullName(git: Runner, dir: string, name: string): string {
  return git(["rev-parse", "--symbolic-full-name", name], dir).stdout.trim();
}

/**
 * The branch a refspec's destination names, without `refs/heads/` or `heads/`. A lone source, or a `HEAD`
 * destination, is read as git's full name for it in `dir`, so `@`, `HEAD` and `heads/main` are `main`. Null for a tag
 * or another `refs/` name, a detached HEAD, and a lone source git does not read as a branch.
 */
function branchOf(git: Runner, dir: string, dst: { name: string; isLone: boolean }): string | null {
  const isRead = dst.isLone || dst.name === HEAD;
  const ref = isRead ? fullName(git, dir, dst.name) : dst.name;

  if (ref.startsWith(HEADS)) return ref.slice(HEADS.length);

  return isRead || ref.startsWith("refs/") ? null : ref.replace(SHORT_HEADS, "");
}

/** The ref one refspec of a push names, in `dir`; null for a delete, a tag, a detached HEAD or an unknown ref. */
function resolveSpec(git: Runner, dir: string, spec: string): PushedRef | null {
  const [given, target] = spec.replace(FORCE_PREFIX, "").split(":");
  const src = given === "" || given === undefined ? HEAD : given;
  const branch = branchOf(git, dir, { isLone: target === undefined, name: target ?? src });
  const sha = git(["rev-parse", "--verify", src], dir);

  return given === "" || branch === null || sha.code !== 0 ? null : { branch, dir, sha: sha.stdout.trim(), src };
}

/** Every branch ref one push updates, resolved in its dir; no refspec pushes `HEAD`. */
function refsOfPush(git: Runner, { dir, refs }: Push): PushedRef[] {
  return (refs.length > 0 ? refs : [HEAD]).flatMap((spec) => resolveSpec(git, dir, spec) ?? []);
}

/** Every branch ref the push forms in `command` update, resolved where each push runs. */
export function pushedRefs(c: Host, command: string, cwd: string): PushedRef[] {
  return pushesIn(c, command, cwd).flatMap((push) => refsOfPush(c.git, push));
}

/** Every branch ref `git push <rest>` updates when it runs in `dir`. */
export function pushRefs(git: Runner, dir: string, rest: readonly string[]): PushedRef[] {
  return refsOfPush(git, { dir, refs: specsOf(rest) });
}
