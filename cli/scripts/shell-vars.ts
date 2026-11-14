/** How the commands of a line change the variables a walk knows, as bash sets, joins and loses them. */
import os from "node:os";

import { repoEnv } from "../repo-env.ts";
import type { Dir, ShellWord, Simple, StartEnv, Value, Vars } from "./shell-ast.types.ts";
import { expandValue, lookup } from "./shell-expand.ts";
import { readWord } from "./shell-fields.ts";
import { programAt, programBase } from "./shell-scripts.ts";
import { ASSIGNMENT_RE, END_OF_OPTIONS, PRINTF, PRINTF_VAR_OPTION, SETTERS, UNSET } from "./shell.constants.ts";

/** The head of an assignment word: its `NAME=` text, the name, whether it sets an array entry, and whether `+=`. */
type AssignHead = { head: string; name: string; isEntry: boolean; isAppend: boolean };

/**
 * Builtins that set or drop variables in ways the gate does not follow (a local scope, a value read from input, a
 * sourced or evaluated text, a trap, a builtin run by name), so every variable is forgotten after them.
 */
const FORGETTERS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "local",
  "declare",
  "typeset",
  "read",
  "mapfile",
  "readarray",
  "getopts",
  "source",
  ".",
  "let",
  "command",
  "builtin",
  "eval",
  "trap",
]);

/** The options `unset` takes that the walk follows: `-v` for variables, `-f` for functions only. */
const UNSET_OPTIONS_RE = /^-[fv]+$/;

/** The variable an `unset` operand names: its leading name, so `A[0]` drops `A`. */
const UNSET_NAME_RE = /^[A-Za-z_]\w*/;

/** An expansion that assigns: `${x=y}`, `${x:=y}`, or arithmetic with `=`, `++` or `--`. */
const ASSIGNING_RE = /^\$\{#?\w+:?=|^\$\(\(.*(?:[^=!<>]=[^=]|\+\+|--)/s;

/** The `IFS` bash starts with: a blank, a tab and a newline. */
const DEFAULT_IFS = " \t\n";

/** The cause a variable gets when the branches of a join give it different values. */
const BRANCH_CAUSE = "a variable set in a branch";

function known(text: string): Value {
  return { known: true, text };
}

/** The start variables of a line the hook judges: this process's home and `CDPATH`, which the shell inherits. */
export function processEnv(): StartEnv {
  return { cdpath: repoEnv.process.CDPATH ?? "", home: os.homedir(), path: repoEnv.process.PATH ?? "" };
}

/**
 * The variables a walk starts with: `HOME`, `CDPATH` and `PATH` from `env`, `PWD` as the start dir, and bash's own
 * `IFS`.
 */
export function seedVars(env: StartEnv, cwd: string): Vars {
  return new Map([
    ["HOME", known(env.home)],
    ["CDPATH", known(env.cdpath)],
    ["PATH", known(env.path)],
    ["PWD", known(cwd)],
    ["IFS", known(DEFAULT_IFS)],
  ]);
}

/** `vars` with `name` set to `value`. */
export function withVar(vars: Vars, name: string, value: Value): Vars {
  return new Map([...vars, [name, value]]);
}

/** `vars` with `PWD` set to `dir`, as a `cd` sets it. */
export function withDir(vars: Vars, dir: Dir): Vars {
  return withVar(vars, "PWD", dir.known ? known(dir.path) : { cause: dir.cause, known: false });
}

function sameValue(a: Value | undefined, b: Value | undefined): boolean {
  return a?.known === true && b?.known === true && a.text === b.text;
}

/** True when both hold the same known values. */
export function sameVars(a: Vars, b: Vars): boolean {
  return a.size === b.size && [...a].every(([name, value]) => sameValue(value, b.get(name)));
}

/** The variables after one of two branches ran: each that both give one known value, the rest unknown. */
export function joinVars(a: Vars, b: Vars): Vars {
  const names = new Set([...a.keys(), ...b.keys()]);

  return new Map(
    [...names].map((n): [string, Value] => [
      n,
      sameValue(a.get(n), b.get(n)) ? lookup(a, n) : { cause: BRANCH_CAUSE, known: false },
    ]),
  );
}

/** The name an assignment word sets and the value it gives, read in `vars`; null when `word` assigns nothing. */
export function assignment(word: ShellWord, vars: Vars): { name: string; value: Value } | null {
  const m = ASSIGNMENT_RE.exec(word.raw);

  if (m === null) return null;
  const [head, name, entry, append] = m;
  const at: AssignHead = { head, isAppend: append === "+", isEntry: entry !== undefined, name: String(name) };

  return { name: at.name, value: assignedValue(word, at, vars) };
}

/**
 * The value an assignment word gives its name, read in `vars`: `+=` appends to a known value; an array entry, or a
 * `~` after a `:`, which bash expands as a home folder, leaves it unknown.
 */
function assignedValue(word: ShellWord, { head, name, isEntry, isAppend }: AssignHead, vars: Vars): Value {
  const [first, ...rest] = word.parts;
  const raw = word.raw.slice(head.length);

  if (first?.kind !== "lit" || isEntry || raw.includes(":~")) return { cause: raw, known: false };

  const value = {
    parts: [{ ...first, bash: first.bash.slice(head.length), text: first.text.slice(head.length) }, ...rest],
    raw,
  };

  const read = readWord(expandValue(value, vars));
  const old = isAppend ? lookup(vars, name) : known("");

  return read.literal && old.known ? known(old.text + read.text) : { cause: raw, known: false };
}

/** `vars` after each `NAME=value` of `words`, left to right, each value read with those before it set. */
function assigned(words: readonly ShellWord[], vars: Vars): Vars {
  let got = vars;

  for (const w of words) {
    const set = assignment(w, got);

    if (set !== null) got = withVar(got, set.name, set.value);
  }

  return got;
}

/**
 * `vars` after `unset` with `args`: each variable it names is dropped, so the walk reads it as unknown (bash reads it
 * empty unless it is readonly, which the walk does not track). `-f` drops only functions, which the gate judges both as
 * the function and as the program, so the variables stay. `-n`, another option, or a word the gate cannot read
 * forgets every variable.
 */
function unsetVars(args: readonly ShellWord[], vars: Vars): Vars {
  const read = args.map(readWord);

  if (read.some((r) => !r.literal)) return new Map();
  const words = read.map((r) => r.text);
  const at = words.findIndex((w) => w === END_OF_OPTIONS || !w.startsWith("-") || w === "-");
  const options = at < 0 ? words : words.slice(0, at);

  if (!options.every((o) => UNSET_OPTIONS_RE.test(o))) return new Map();

  if (options.some((o) => o.includes("f"))) return vars;
  const operands = at < 0 ? [] : words.slice(words[at] === END_OF_OPTIONS ? at + 1 : at);
  const dropped = new Set(operands.map((w) => UNSET_NAME_RE.exec(w)?.[0]));

  return new Map([...vars].filter(([name]) => !dropped.has(name)));
}

/** True when a word of `c` holds an expansion that assigns a variable. */
function assignsInWord(c: Simple): boolean {
  return c.words.some((w) => w.parts.some((part) => part.kind === "param" && ASSIGNING_RE.test(part.raw)));
}

/**
 * The variables after `c` ran with `vars`: a line of only assignments, or `export`/`readonly`, sets them; `unset`
 * drops the ones it names; a builtin the gate does not follow, a program it cannot name, or an assigning expansion
 * forgets them all; any other command leaves them, since a prefix `NAME=value` is the program's own.
 */
export function varsAfter(c: Simple, vars: Vars): Vars {
  const at = programAt(c.words);
  const prog = c.words[at];

  if (assignsInWord(c)) return new Map();

  if (prog === undefined) return assigned(c.words, vars);
  const read = readWord(prog);
  const name = read.literal ? programBase(read.text) : "";

  if (SETTERS.has(name)) return assigned(c.words.slice(at + 1), vars);

  if (name === UNSET) return unsetVars(c.words.slice(at + 1), vars);

  return name === "" ||
    FORGETTERS.has(name) ||
    (name === PRINTF && c.words.some((w) => readWord(w).text === PRINTF_VAR_OPTION))
    ? new Map()
    : vars;
}
