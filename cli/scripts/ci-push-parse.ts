/**
 * Reads the `git push`, `repo push` and pull-request `repo worktree finish` forms out of a shell command: where each
 * runs, and which branch and commit it names.
 */
import path from "node:path";

import { readWorkflow } from "../workflow.ts";
import { CD, CONFIG_OPTION, DIR_OPTION, GIT, HEAD, PUSH } from "./ci-push-parse.constants.ts";
import { recordRoot } from "./ci-wait-record.ts";
import type { Runner } from "./ci-wait-run.ts";
import { pickTarget } from "./push-target.ts";
import { BUN, REPO } from "./push.constants.ts";
import { canonicalPath } from "./workspace-root.ts";
import { worktreeName } from "./worktree-git.ts";
import { BRANCH_PREFIX, FINISH_CMD, WORKTREE_SUB } from "./worktree.constants.ts";

const SEGMENT = /&&|\|\||[;|\n]/;
const WORD = /"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>\S+)/g;
const ENV_ASSIGN = /^[A-Za-z_]\w*=/;
const WINDOWS_PATH = /^([A-Za-z]:[\\/]|\\\\)/;
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

/** `dir` from `base`, in the spelling of whichever side is a Windows path. */
function resolveDir(base: string, dir: string): string {
  const flavor = WINDOWS_PATH.test(dir) || WINDOWS_PATH.test(base) ? path.win32 : path;

  return flavor.resolve(base, dir);
}

function wordsOf(text: string): string[] {
  return [...text.matchAll(WORD)].map(({ groups }) => String(groups?.double ?? groups?.single ?? groups?.bare));
}

/** The push in `git <words>`, with the directory its `-C` options lead to; null for any other git command. */
function parsePush(words: string[], base: string): Push | null {
  let dir = base;
  let i = 0;

  for (; words[i]?.startsWith("-") === true; i++) {
    if (words[i] === DIR_OPTION) dir = resolveDir(dir, String(words[++i]));
    else if (words[i] === CONFIG_OPTION) i++;
  }

  return words[i] === PUSH ? { dir, refs: specsOf(words.slice(i + 1)) } : null;
}

/** The refspecs among the words after `push`: every word past the remote that is not a flag. */
function specsOf(rest: readonly string[]): string[] {
  return rest.filter((w) => !w.startsWith("-")).slice(1);
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
 * Every `git push`, `repo push` and pull-request `repo worktree finish` in a shell command, each with the directory it
 * runs in after the `cd`s before it.
 */
function pushesIn(git: Runner, command: string, cwd: string): Push[] {
  const found: Push[] = [];
  let here = cwd;

  for (const segment of command.split(SEGMENT)) {
    const words = wordsOf(segment);

    while (ENV_ASSIGN.test(words[0] ?? "")) words.shift();

    if (words[0] === CD && words[1] !== undefined && words[1] !== "") here = resolveDir(here, words[1]);
    const push = words[0] === GIT ? parsePush(words.slice(1), here) : parseRepo(git, words, here);

    if (push !== null) found.push(push);
  }

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
export function pushedRefs(git: Runner, command: string, cwd: string): PushedRef[] {
  return pushesIn(git, command, cwd).flatMap((p) => refsOfPush(git, p));
}

/** Every branch ref `git push <rest>` updates when it runs in `dir`. */
export function pushRefs(git: Runner, dir: string, rest: readonly string[]): PushedRef[] {
  return refsOfPush(git, { dir, refs: specsOf(rest) });
}
