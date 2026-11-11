/** Reads the `git push` forms out of a shell command: where each runs, and which branch and commit it names. */
import path from "node:path";

import { CD, CONFIG_OPTION, DIR_OPTION, GIT, HEAD, PUSH } from "./ci-push-parse.constants.ts";
import type { Runner } from "./ci-wait-run.ts";

const SEGMENT = /&&|\|\||[;|\n]/;
const WORD = /"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>\S+)/g;
const ENV_ASSIGN = /^[A-Za-z_]\w*=/;
const WINDOWS_PATH = /^([A-Za-z]:[\\/]|\\\\)/;
const HEADS = "refs/heads/";
const FORCE_PREFIX = /^\+/;

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
  if (words[i] !== PUSH) return null;
  const args = words.slice(i + 1).filter((w) => !w.startsWith("-"));
  return { dir, refs: args.slice(1) };
}

/** Every `git push` in a shell command, each with the directory it runs in after the `cd`s before it. */
function pushesIn(command: string, cwd: string): Push[] {
  const found: Push[] = [];
  let here = cwd;
  for (const segment of command.split(SEGMENT)) {
    const words = wordsOf(segment);
    while (ENV_ASSIGN.test(words[0] ?? "")) words.shift();
    if (words[0] === CD && words[1] !== undefined && words[1] !== "") here = resolveDir(here, words[1]);
    const push = words[0] === GIT ? parsePush(words.slice(1), here) : null;
    if (push !== null) found.push(push);
  }
  return found;
}

/** The ref one refspec of a push names, in `dir`; null for a delete, a tag, a detached HEAD or an unknown ref. */
function resolveSpec(git: Runner, dir: string, spec: string): PushedRef | null {
  const [given, target] = spec.replace(FORCE_PREFIX, "").split(":");
  const src = given === "" || given === undefined ? HEAD : given;
  const dst = target ?? src;
  const head = dst === HEAD ? git(["rev-parse", "--abbrev-ref", HEAD], dir).stdout.trim() : dst;
  const branch = head.startsWith(HEADS) ? head.slice(HEADS.length) : head;
  const sha = git(["rev-parse", "--verify", src], dir);
  const skip = given === "" || branch === HEAD || branch.startsWith("refs/") || sha.code !== 0;
  return skip ? null : { branch, dir, sha: sha.stdout.trim(), src };
}

/** Every branch ref the `git push` forms in `command` update, resolved in the directory each push runs in. */
export function pushedRefs(git: Runner, command: string, cwd: string): PushedRef[] {
  return pushesIn(command, cwd).flatMap((p) =>
    (p.refs.length > 0 ? p.refs : [HEAD]).flatMap((spec) => resolveSpec(git, p.dir, spec) ?? []),
  );
}
