/** The dir a `cd`, `pushd` or `popd` moves to, as far as the gate can know it before the shell runs. */
import type path from "node:path";

import type { Dir, ReadWord, ShellWord } from "./shell-ast.types.ts";
import { isLiteral, readWord, scriptText } from "./shell-lex-word.ts";
import { programAt } from "./shell-scripts.ts";
import { CD, CD_OPTIONS, DIR_CHANGERS, END_OF_OPTIONS, POPD, STDIN_OPERAND } from "./shell.constants.ts";

function unknown(cause: string): Dir {
  return { cause, known: false };
}

/** The words after the program and its options, past a `--`. */
function operands(words: readonly ShellWord[], prog: number): readonly ShellWord[] {
  let i = prog + 1;

  for (let t = words[i]; t !== undefined && CD_OPTIONS.has(t.raw); t = words[++i]);

  return words.slice(words[i]?.raw === END_OF_OPTIONS ? i + 1 : i);
}

/**
 * The dir the path `to` names from `dir`: unknown, named by the text typed, when its value is not known; a relative
 * path from an unknown dir stays unknown.
 */
export function movedDir(to: ReadWord, dir: Dir, p: typeof path): Dir {
  if (!to.literal) return unknown(to.raw);

  if (p.isAbsolute(to.text)) return { known: true, path: p.resolve(to.text) };

  return dir.known ? { known: true, path: p.resolve(dir.path, to.text) } : dir;
}

/** The dir one operand names from `dir`; unknown for `-` and a stack entry too. */
function resolveOperand(word: ShellWord, dir: Dir, p: typeof path): Dir {
  const to = readWord(word);

  if (word.raw.startsWith("+")) return unknown(word.raw);

  return to.literal && to.text === STDIN_OPERAND ? unknown("the folder of cd -") : movedDir(to, dir, p);
}

/** The dir after `words` when they change it, from `dir`; null when they are no `cd`, `pushd` or `popd`. */
export function cdEffect(words: readonly ShellWord[], dir: Dir, p: typeof path): Dir | null {
  const prog = programAt(words);
  const word = words[prog];
  const name = word !== undefined && isLiteral(word) ? scriptText(word) : "";

  if (!DIR_CHANGERS.has(name)) return null;
  const args = operands(words, prog);
  const [only] = args;

  if (name === POPD) return unknown("the folder of popd");

  if (only === undefined) return unknown(name === CD ? "the home folder" : "the folder of pushd");

  return args.length === 1 ? resolveOperand(only, dir, p) : unknown(args.map((a) => a.raw).join(" "));
}
