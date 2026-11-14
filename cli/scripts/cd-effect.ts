/** The dir a `cd`, `pushd` or `popd` moves to, as far as the gate can know it before the shell runs. */
import type path from "node:path";

import type { Dir, Scope, ShellWord, Value, Vars } from "./shell-ast.types.ts";
import { expandWord, lookup, valueOf } from "./shell-expand.ts";
import { programAt } from "./shell-scripts.ts";
import { CD, CD_OPTIONS, DIR_CHANGERS, END_OF_OPTIONS, POPD, STDIN_OPERAND } from "./shell.constants.ts";

/** A relative path bash never looks up in `CDPATH`: `.`, `..`, or one that starts with either. */
const DOT_PATH_RE = /^\.\.?(?:[/\\]|$)/;

function unknown(cause: string): Dir {
  return { cause, known: false };
}

/** True when `cd` would look the relative path `to` up in a `CDPATH` that is set or unknown, not in the dir. */
function searchesCdPath(to: string, vars: Vars, p: typeof path): boolean {
  const cdpath = lookup(vars, "CDPATH");

  return !(cdpath.known && cdpath.text === "") && !p.isAbsolute(to) && !DOT_PATH_RE.test(to);
}

/** The words after the program and its options, past a `--`. */
function operands(words: readonly ShellWord[], prog: number): readonly ShellWord[] {
  let i = prog + 1;

  for (let t = words[i]; t !== undefined && CD_OPTIONS.has(t.raw); t = words[++i]);

  return words.slice(words[i]?.raw === END_OF_OPTIONS ? i + 1 : i);
}

/**
 * The dir the path `to` names from `dir`: unknown, named by the text that lost it, when its value is not known; a
 * relative path from an unknown dir stays unknown.
 */
export function movedDir(to: Value, dir: Dir, p: typeof path): Dir {
  if (!to.known) return unknown(to.cause);

  if (p.isAbsolute(to.text)) return { known: true, path: p.resolve(to.text) };

  return dir.known ? { known: true, path: p.resolve(dir.path, to.text) } : dir;
}

/** The dir a bare `cd` goes to: `HOME` when the walk knows it as an absolute path. */
function homeDir(scope: Scope, p: typeof path): Dir {
  const home = lookup(scope.vars, "HOME");

  return home.known && p.isAbsolute(home.text)
    ? { known: true, path: p.resolve(home.text) }
    : unknown("the home folder");
}

/** The dir one operand names in `scope`; unknown for `-`, a stack entry, and a path `CDPATH` may find elsewhere. */
function resolveOperand(word: ShellWord, { dir, vars }: Scope, p: typeof path): Dir {
  const to = valueOf(expandWord(word, vars));

  if (word.raw.startsWith("+")) return unknown(word.raw);

  if (to.known && to.text === STDIN_OPERAND) return unknown("the folder of cd -");

  return to.known && searchesCdPath(to.text, vars, p) ? unknown(`${word.raw} in CDPATH`) : movedDir(to, dir, p);
}

/**
 * The dir after `words` when they change it, from the dir of `scope`, each word read with its variables; null when
 * they are no `cd`, `pushd` or `popd`.
 */
export function cdEffect(words: readonly ShellWord[], scope: Scope, p: typeof path): Dir | null {
  const prog = programAt(words);
  const word = words[prog];
  const read = word === undefined ? null : expandWord(word, scope.vars);
  const name = read?.literal === true ? read.text : "";

  if (!DIR_CHANGERS.has(name)) return null;
  const args = operands(words, prog);
  const [only] = args;

  if (name === POPD) return unknown("the folder of popd");

  if (only === undefined) return name === CD ? homeDir(scope, p) : unknown("the folder of pushd");

  return args.length === 1 ? resolveOperand(only, scope, p) : unknown(args.map((a) => a.raw).join(" "));
}
