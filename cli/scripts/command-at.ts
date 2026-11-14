/** The program a simple command runs once runners such as `env`, `sudo`, `rtk` or `timeout` are passed. */
import type { ShellWord } from "./shell-ast.types.ts";
import { isLiteral, scriptText } from "./shell-lex-word.ts";
import { programAt, programName } from "./shell-scripts.ts";
import { ASSIGNMENT_RE, END_OF_OPTIONS, type Runner, RUNNER_SPECS } from "./shell.constants.ts";

/** The words an option and its value take. */
const OPTION_AND_VALUE = 2;

function textAt(words: readonly ShellWord[], i: number): string {
  const word = words[i];

  return word === undefined ? "" : scriptText(word);
}

function specOf(word: ShellWord | undefined): Runner | undefined {
  return word !== undefined && isLiteral(word) ? RUNNER_SPECS.get(programName(word)) : undefined;
}

/** The index past the runner at `at`: its options and their values, a `--`, assignments, and its own operands. */
function pastRunner(words: readonly ShellWord[], at: number, spec: Runner): number {
  let i = at + 1;
  let hasOptions = true;

  for (let t = textAt(words, i); (hasOptions && t.startsWith("-")) || ASSIGNMENT_RE.test(t); t = textAt(words, i)) {
    hasOptions &&= t !== END_OF_OPTIONS;
    i += hasOptions && spec.values.includes(t) ? OPTION_AND_VALUE : 1;
  }

  return i + spec.operands;
}

/** The index of the program `words` run, past assignments and runners; `words.length` when there is none. */
export function commandAt(words: readonly ShellWord[]): number {
  let i = programAt(words);

  for (let spec = specOf(words[i]); spec !== undefined; spec = specOf(words[i])) i = pastRunner(words, i, spec);

  return Math.min(i, words.length);
}
