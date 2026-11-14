/**
 * The program a simple command runs once runners such as `env`, `sudo`, `rtk` or `timeout` are passed, and the dir
 * their `-C`, `-D` or `--chdir` options make it run in.
 */
import type path from "node:path";

import { movedDir } from "./cd-effect.ts";
import type { Dir, ShellWord, Value } from "./shell-ast.types.ts";
import { optionValue, readWord, valueOf } from "./shell-fields.ts";
import { isLiteral, scriptText } from "./shell-lex-word.ts";
import { programAt, programName } from "./shell-scripts.ts";
import { ASSIGNMENT_RE, END_OF_OPTIONS, type Runner, RUNNER_SPECS } from "./shell.constants.ts";

/** The words an option and its value take. */
const OPTION_AND_VALUE = 2;

/** Where the runners leave the scan: the index of the program, and the dirs their options named, in order. */
type Past = { at: number; dirs: Value[] };

function textAt(words: readonly ShellWord[], i: number): string {
  const word = words[i];

  return word === undefined ? "" : scriptText(word);
}

function specOf(word: ShellWord | undefined): Runner | undefined {
  return word !== undefined && isLiteral(word) ? RUNNER_SPECS.get(programName(word)) : undefined;
}

/**
 * The dir the option at `i` names when it is one of `dirs`: `-C d`, `--chdir d`, `--chdir=d` or `-Cd`; null for
 * another option, and for a dir option with no value.
 */
function dirAt(words: readonly ShellWord[], i: number, dirs: readonly string[]): Value | null {
  const [word, value] = [words[i], words[i + 1]];
  const t = textAt(words, i);

  if (dirs.includes(t)) return value === undefined ? null : valueOf(readWord(value));
  const prefix = dirs.map((d) => (d.startsWith("--") ? `${d}=` : d)).find((d) => t.startsWith(d));

  return prefix === undefined || word === undefined ? null : optionValue(readWord(word), prefix);
}

/**
 * Past the runner at `at`: the index after its options and their values, a `--`, assignments and its own operands,
 * and the dirs its dir options name.
 */
function pastRunner(words: readonly ShellWord[], at: number, spec: Runner): Past {
  const dirs: Value[] = [];
  let i = at + 1;
  let hasOptions = true;

  for (let t = textAt(words, i); (hasOptions && t.startsWith("-")) || ASSIGNMENT_RE.test(t); t = textAt(words, i)) {
    hasOptions &&= t !== END_OF_OPTIONS;
    const dir = hasOptions ? dirAt(words, i, spec.dirs) : null;

    if (dir !== null) dirs.push(dir);
    i += hasOptions && spec.values.includes(t) ? OPTION_AND_VALUE : 1;
  }

  return { at: i + spec.operands, dirs };
}

/** The runners before the program of `words`, passed. */
function pastRunners(words: readonly ShellWord[]): Past {
  const dirs: Value[] = [];
  let i = programAt(words);

  for (let spec = specOf(words[i]); spec !== undefined; spec = specOf(words[i])) {
    const past = pastRunner(words, i, spec);
    dirs.push(...past.dirs);
    i = past.at;
  }

  return { at: Math.min(i, words.length), dirs };
}

/** The index of the program `words` run, past assignments and runners; `words.length` when there is none. */
export function commandAt(words: readonly ShellWord[]): number {
  return pastRunners(words).at;
}

/** The dir the program of `words` runs in from `dir`: moved by each runner's dir option, in order. */
export function runDir(words: readonly ShellWord[], dir: Dir, p: typeof path): Dir {
  let at = dir;

  for (const to of pastRunners(words).dirs) at = movedDir(to, at, p);

  return at;
}
