/**
 * The words of a simple command that its program never opens as a file: the pattern of a grep, rg or fd run and the
 * value of a find name test. The Bash gate skips them, so a pattern that spells a denied dir name is not judged as a
 * path. Each skip is taken only when the parse is certain; any doubt leaves every word judged.
 */
import path from "node:path";

import {
  END_OF_OPTIONS,
  EXEC_ACTIONS,
  EXEC_BATCH_END,
  EXEC_BATCH_MARK,
  EXEC_END,
  FIND_PROGRAM,
  FIND_NAME_TESTS,
  PATTERN_COMMANDS,
  type PatternGrammar,
} from "./pattern-words.constants.ts";

/** A Windows program's `.exe` ending, dropped before a command name is matched. */
const EXE_EXT_RE = /\.exe$/i;

const NONE: ReadonlySet<number> = /* @__PURE__ */ new Set<number>();

/** The program a first word runs, bare or by path, without a Windows `.exe` ending. */
function programOf(word: string): string {
  return path.posix.basename(word.replaceAll("\\", "/")).replace(EXE_EXT_RE, "");
}

/** True when `word` is an option word, not `-` (stdin) and not `--`. */
function isOption(word: string): boolean {
  return word.startsWith("-") && word !== "-" && word !== END_OF_OPTIONS;
}

/** The long option's name without its `=value`. */
function longName(word: string): string {
  const at = word.indexOf("=");

  return at < 0 ? word : word.slice(0, at);
}

/** True when an option word can give the pattern some other way, or turn the run into one with no pattern. */
function setsPattern(word: string, grammar: PatternGrammar): boolean {
  if (word.startsWith("--")) {
    const name = longName(word);

    return grammar.sourceLongs.some((source) => source.startsWith(name));
  }

  return word
    .slice(1)
    .split("")
    .some((letter) => grammar.sourceShorts.includes(letter));
}

/** True when an option word before the pattern surely takes no separate value. */
function takesNoValue(word: string, grammar: PatternGrammar): boolean {
  if (word.startsWith("--")) return word.includes("=") || grammar.flagLongs.includes(word);

  return word
    .slice(1)
    .split("")
    .every((letter) => grammar.flagShorts.includes(letter));
}

/** The index of the pattern operand of a grep, rg or fd run, or null when it is not certain. */
function patternIndex(words: readonly string[], grammar: PatternGrammar): number | null {
  const end = words.indexOf(END_OF_OPTIONS);
  const options = (end < 0 ? words : words.slice(0, end)).slice(1).filter((word) => isOption(word));

  if (options.some((word) => setsPattern(word, grammar))) return null;

  for (const [i, word] of words.entries()) {
    if (i === 0) continue;

    if (word === END_OF_OPTIONS) return i + 1 < words.length ? i + 1 : null;

    if (!isOption(word)) return i;

    if (!takesNoValue(word, grammar)) return null;
  }

  return null;
}

/** The indices of the values of find's name tests, outside any `-exec`-like action. */
function findNameValues(words: readonly string[]): Set<number> {
  const skip = new Set<number>();
  let isInExec = false;
  let isValue = false;

  for (const [i, word] of words.entries()) {
    if (isValue) {
      skip.add(i);
      isValue = false;
    } else if (isInExec) {
      isInExec = !(word === EXEC_END || (word === EXEC_BATCH_END && words[i - 1] === EXEC_BATCH_MARK));
    } else if (EXEC_ACTIONS.has(word)) {
      isInExec = true;
    } else {
      isValue = FIND_NAME_TESTS.has(word);
    }
  }

  return skip;
}

/** The indices of `words` that its program never opens as a file; empty when none is certain. */
export function patternWords(words: readonly string[]): ReadonlySet<number> {
  const [first = ""] = words;
  const program = programOf(first);

  if (program === FIND_PROGRAM) return findNameValues(words);
  const grammar = PATTERN_COMMANDS.get(program);

  if (grammar === undefined) return NONE;
  const at = patternIndex(words, grammar);

  return at === null ? NONE : new Set([at]);
}
