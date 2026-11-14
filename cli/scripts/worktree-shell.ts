/** The git commands a shell line runs, each with the dir it runs in, read from the shared bash walk. */
import type path from "node:path";

import { movedDir } from "./cd-effect.ts";
import { commandAt } from "./command-at.ts";
import type { Dir, ReadWord, Scope, ShellWord, Value, Vars } from "./shell-ast.types.ts";
import { optionValue, readWord, valueOf } from "./shell-fields.ts";
import { shellFlow } from "./shell-flow.ts";
import { programAt, programBase } from "./shell-scripts.ts";
import { assignment, processEnv, withVar } from "./shell-vars.ts";
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

/** A field a runner such as `env` reads as `NAME=value`: the name, and the text after the `=`. */
const SET_TEXT_RE = /^([A-Za-z_]\w*)=(.*)$/s;

/** The name before the `=` of `w`, or "" when it has none. */
function nameOf(w: ReadWord): string {
  const eq = w.text.indexOf("=");

  return eq < 0 ? "" : w.text.slice(0, eq);
}

/**
 * The index git runs at: the program past runners (`env`, `sudo`, `rtk`, …) when its value is git or unknown, which
 * may be git; null for any other program.
 */
function gitAt(words: readonly ShellWord[], read: readonly ReadWord[]): number | null {
  const at = commandAt(words);
  const prog = read[at];

  return prog !== undefined && (!prog.literal || programBase(prog.text) === GIT_BIN) ? at : null;
}

/** The git option at `at.next`: the dir it sets and where the scan goes on; null at the end or a missing value. */
function gitOption(words: readonly ReadWord[], at: OptionStep, p: typeof path): OptionStep | null {
  const { dir, next: i } = at;
  const w = words[i];
  const value = words[i + 1];
  const pastValue = i + OPTION_AND_VALUE;

  if (w === undefined) return null;

  if (DIR_OPTIONS.has(w.text))
    return value === undefined ? null : { dir: movedDir(valueOf(value), dir, p), next: pastValue };

  if (LONG_DIR_OPTIONS.has(nameOf(w))) return { dir: movedDir(optionValue(w, `${nameOf(w)}=`), dir, p), next: i + 1 };

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

/**
 * The variable a runner's `NAME=value` field sets, as the runner reads it; unknown when a part is, or when the value
 * holds a `~` bash may have expanded.
 */
function runnerAssignment(field: ShellWord): { name: string; value: Value } | null {
  const read = readWord(field);
  const m = SET_TEXT_RE.exec(read.text);

  if (m === null) return null;
  const [, set, value] = m;
  const [name, text] = [String(set), String(value)];
  const isKnown = read.literal && !text.startsWith("~") && !text.includes(":~");

  return { name, value: isKnown ? { known: true, text } : { cause: read.raw, known: false } };
}

/**
 * The dir `GIT_DIR=` or `GIT_WORK_TREE=` before git moves to from `dir`: the assignments before the program, each
 * value read with those before it set, as bash runs them left to right, then the ones a runner such as `env` sets.
 */
function prefixDir(words: readonly ShellWord[], { dir, vars }: Scope, p: typeof path): Dir {
  const prog = programAt(words);
  let here = dir;
  let seen: Vars = vars;

  for (const [i, w] of words.entries()) {
    const set = i < prog ? assignment(w, seen) : runnerAssignment(w);

    if (set === null) continue;
    seen = withVar(seen, set.name, set.value);

    if (DIR_VARIABLES.has(set.name)) here = movedDir(set.value, here, p);
  }

  return here;
}

/** The git command of one simple command run in `scope`, its dir moved by the assignments before git; else null. */
export function gitCommandOf(words: readonly ShellWord[], scope: Scope, p: typeof path): GitCommand | null {
  const read = words.map(readWord);
  const at = gitAt(words, read);

  return at === null ? null : afterOptions(read.slice(at + 1), prefixDir(words.slice(0, at), scope, p), p);
}

/**
 * Every git command a shell line runs from `cwd`, with its dir, and every script a shell runs that the gate cannot
 * read.
 */
export function gitLine(command: string, cwd: string, p: typeof path): GitLine {
  const line: GitLine = { commands: [], unread: [] };

  shellFlow(command, { cwd, env: processEnv(), p }, (v) => {
    if (v.kind === "opaque") {
      line.unread.push({ at: v.dir, cause: v.cause });

      return;
    }

    const g = v.data === undefined ? gitCommandOf(v.words, v, p) : null;

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
