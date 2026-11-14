/** The git commands a shell line runs, each with the dir it runs in, read from the shared bash walk. */
import type path from "node:path";

import { movedDir } from "./cd-effect.ts";
import { commandAt } from "./command-at.ts";
import type { Dir, ReadWord, ShellWord } from "./shell-ast.types.ts";
import { shellFlow } from "./shell-flow.ts";
import { isLiteral, readWord } from "./shell-lex-word.ts";
import { programName } from "./shell-scripts.ts";
import {
  ADD_CMD,
  ADD_VALUE_FLAGS,
  CONFIG_FLAG,
  DETACH_FLAG,
  DETACH_SHORT,
  DIR_OPTIONS,
  DIR_VARIABLES,
  GIT_BIN,
  LONG_DIR_OPTIONS,
  REASON_FLAG,
  WORKTREE_SUB,
} from "./worktree.constants.ts";
import type { GitCommand, GitLine, WorktreeAdd } from "./worktree.types.ts";

/** Where git's options left the scan: the dir they set and the index of the next word. */
type OptionStep = { dir: Dir; next: number };

/** The words an option and its value take. */
const OPTION_AND_VALUE = 2;

/** `NAME=value` or `--name=value` as its value, still literal only when the value has no leading `~`. */
function afterEquals(w: ReadWord): ReadWord {
  const raw = w.raw.slice(w.raw.indexOf("=") + 1);

  return { literal: w.literal && !raw.startsWith("~"), raw, text: w.text.slice(w.text.indexOf("=") + 1) };
}

/** The name before the `=` of `w`, or "" when it has none. */
function nameOf(w: ReadWord): string {
  const eq = w.text.indexOf("=");

  return eq < 0 ? "" : w.text.slice(0, eq);
}

/**
 * The index git runs at: the program past runners (`env`, `sudo`, `rtk`, …) when it is git or an expansion, which may
 * be git; null for any other program.
 */
function gitAt(words: readonly ShellWord[]): number | null {
  const at = commandAt(words);
  const prog = words[at];

  return prog !== undefined && (!isLiteral(prog) || programName(prog) === GIT_BIN) ? at : null;
}

/** The git option at `at.next`: the dir it sets and where the scan goes on; null at the end or a missing value. */
function gitOption(words: readonly ReadWord[], at: OptionStep, p: typeof path): OptionStep | null {
  const { dir, next: i } = at;
  const w = words[i];
  const value = words[i + 1];
  const pastValue = i + OPTION_AND_VALUE;

  if (w === undefined) return null;

  if (DIR_OPTIONS.has(w.text)) return value === undefined ? null : { dir: movedDir(value, dir, p), next: pastValue };

  if (LONG_DIR_OPTIONS.has(nameOf(w))) return { dir: movedDir(afterEquals(w), dir, p), next: i + 1 };

  return { dir, next: w.text === CONFIG_FLAG ? pastValue : i + 1 };
}

/** The git command after git's own options, run where they lead; null when no subcommand follows. */
function afterOptions(words: readonly ReadWord[], start: Dir, p: typeof path): GitCommand | null {
  for (let step: OptionStep | null = { dir: start, next: 0 }; step !== null; step = gitOption(words, step, p)) {
    const w = words[step.next];

    if (w !== undefined && !w.text.startsWith("-"))
      return { at: step.dir, rest: words.slice(step.next + 1), sub: w.text };
  }

  return null;
}

/** The git command of one simple command, its dir moved by `GIT_DIR=` or `GIT_WORK_TREE=` before git; else null. */
function gitCommandOf(words: readonly ShellWord[], dir: Dir, p: typeof path): GitCommand | null {
  const at = gitAt(words);

  if (at === null) return null;
  const read = words.map(readWord);
  let here = dir;

  for (const w of read.slice(0, at)) if (DIR_VARIABLES.has(nameOf(w))) here = movedDir(afterEquals(w), here, p);

  return afterOptions(read.slice(at + 1), here, p);
}

/**
 * Every git command a shell line runs from `cwd`, with its dir, and every script a shell runs that the gate cannot
 * read.
 */
export function gitLine(command: string, cwd: string, p: typeof path): GitLine {
  const line: GitLine = { commands: [], unread: [] };

  shellFlow(command, { cwd, p }, (v) => {
    if (v.kind === "opaque") {
      line.unread.push({ at: v.dir, cause: v.cause });

      return;
    }

    const g = v.data === true ? null : gitCommandOf(v.words, v.dir, p);

    if (g !== null) line.commands.push(g);
  });

  return line;
}

/** Fold one word of a `git worktree add` into `out`; a flag that takes a value takes the next word. */
function addArg(out: WorktreeAdd, w: ReadWord, words: Iterator<ReadWord>): void {
  if (ADD_VALUE_FLAGS.includes(w.text)) {
    const value = words.next();

    if (w.text !== REASON_FLAG) out.branch = value.done === true ? null : value.value.text;
  } else if (w.text === DETACH_FLAG || w.text === DETACH_SHORT) {
    out.detach = true;
  } else if (w.text.startsWith("-")) {
    return;
  } else if (out.target === null) {
    out.target = w;
  } else if (out.commitish === null || out.commitish === "") {
    out.commitish = w.text;
  }
}

/** `{ at, target, branch, commitish, detach }` for a `git … worktree add …` command, else null. */
export function worktreeAddOf(g: GitCommand): WorktreeAdd | null {
  const [first, ...args] = g.rest;

  if (g.sub !== WORKTREE_SUB || first?.text !== ADD_CMD) return null;
  const out: WorktreeAdd = { at: g.at, branch: null, commitish: null, detach: false, target: null };
  const words = args[Symbol.iterator]();

  for (const w of words) addArg(out, w, words);

  return out;
}
