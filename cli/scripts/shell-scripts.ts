/**
 * The scripts a simple command makes bash run: words after `eval`, a shell's `-c` script, the stdin it reads or the
 * file it runs, the file `source` or `.` reads, and the command strings of `su`, `runuser`, `flock`, `script`,
 * `env -S`, `watch`, `trap` and `git rebase --exec`.
 */
import type { Redirect, Script, ShellWord, Simple, Stdin } from "./shell-ast.types.ts";
import { isLiteral, scriptText } from "./shell-lex-word.ts";
import {
  COMMAND_OPTION,
  COMMAND_OPTION_PROGRAMS,
  END_OF_OPTIONS,
  EXEC_OPTION,
  PRINTERS,
  REBASE_SUB,
  RUNNER_SPECS,
  RUNNERS,
  SHELL_VALUE_OPTS,
  SHELLS,
  SPLIT_STRING_OPTION,
  STDIN_OPERAND,
  WATCH_VALUE_OPTS,
  ASSIGNMENT_RE,
  LAST,
} from "./shell.constants.ts";

const SHORT_CLUSTER_RE = /^-[A-Za-z]+$/;
const PATH_SEP_RE = /[\\/]/;
const EXE_RE = /\.exe$/i;

/** One command being read: its words, the index of its program, and the stdin it gets. */
type Cmd = { words: readonly ShellWord[]; prog: number; stdin: Stdin };

/** How a program gives the scripts it runs; null when this use of it runs none. */
type Finder = (cmd: Cmd, at: number) => Script[] | null;

/** A shell's options read from the word after it: where its operands start, and whether `-c` or `-s` was given. */
type ShellOptions = { operand: number; hasCommand: boolean; hasStdinFlag: boolean };

/** The name a program path runs as: its last path part, without `.exe`. */
export function programBase(text: string): string {
  return String(text.split(PATH_SEP_RE).at(LAST)).replace(EXE_RE, "");
}

/** The name a word runs as a program: its last path part, without `.exe`. */
export function programName(word: ShellWord | undefined): string {
  return word === undefined ? "" : programBase(scriptText(word));
}

function textOf(word: ShellWord | undefined): string {
  return word === undefined ? "" : scriptText(word);
}

/** A script that runs in a child shell. */
function script(text: string): Script[] {
  return [{ inherits: false, kind: "text", text }];
}

/** The words after index `i` as one command line. */
function lineAfter(words: readonly ShellWord[], i: number): string {
  return words
    .slice(i + 1)
    .map(scriptText)
    .join(" ");
}

/** `eval`'s words, in the caller's state when it is the program. */
function evalScript(cmd: Cmd, at: number): Script[] {
  return [{ inherits: at === cmd.prog, kind: "text", text: lineAfter(cmd.words, at) }];
}

/** The stdin a shell at `at` reads as a script: only at program position or behind a runner. */
function stdinScript(cmd: Cmd, at: number): Script[] {
  if (at !== cmd.prog && !RUNNERS.has(programName(cmd.words[cmd.prog]))) return [];

  if (cmd.stdin.kind === "text") return script(cmd.stdin.text);

  return cmd.stdin.kind === "opaque" ? [{ cause: cmd.stdin.cause, kind: "opaque" }] : [];
}

/** The options of a shell at `at`, read to its first operand or `--`. */
function shellOptions(words: readonly ShellWord[], at: number): ShellOptions {
  const got: ShellOptions = { hasCommand: false, hasStdinFlag: false, operand: at + 1 };

  for (let t = textOf(words[got.operand]); t.startsWith("-") || t.startsWith("+"); t = textOf(words[++got.operand])) {
    if (t === END_OF_OPTIONS || t === STDIN_OPERAND) return { ...got, operand: got.operand + 1 };

    if (SHELL_VALUE_OPTS.has(t)) {
      got.operand++;
    } else if (SHORT_CLUSTER_RE.test(t)) {
      got.hasCommand ||= t.includes("c");
      got.hasStdinFlag ||= t.includes("s");
    }
  }

  return got;
}

/**
 * A shell at `at`: its `-c` script, the stdin it reads with `-s` or no operand, or the script file it runs when it is
 * a shell by name that runs, at program position or behind a runner (`echo sh x` runs none); an expanded program word
 * with an operand runs no script the gate reads.
 */
function shellScripts(cmd: Cmd, at: number): Script[] {
  const { operand, hasCommand, hasStdinFlag } = shellOptions(cmd.words, at);
  const word = cmd.words[operand];

  if (hasCommand) return word === undefined ? [] : script(scriptText(word));

  if (word === undefined || hasStdinFlag) return stdinScript(cmd, at);

  const isRun = at === cmd.prog || RUNNER_SPECS.has(programName(cmd.words[cmd.prog]));

  return isRun && SHELLS.has(programName(cmd.words[at])) ? [{ inherits: false, kind: "file", word }] : [];
}

/** `source [--] file` or `. file` at program position: the file, read in the caller's state. */
function sourceScript(cmd: Cmd, at: number): Script[] | null {
  const operand = at + 1;
  const word = cmd.words[textOf(cmd.words[operand]) === END_OF_OPTIONS ? operand + 1 : operand];

  return at !== cmd.prog || word === undefined ? null : [{ inherits: true, kind: "file", word }];
}

/** The script in option `short` or `long` among the words after `at`: `-c v`, `--long v` or `--long=v`. */
function optionScript(words: readonly ShellWord[], at: number, [short, long]: readonly string[]): Script[] | null {
  for (let i = at + 1; i < words.length; i++) {
    const t = textOf(words[i]);
    const next = words[i + 1];

    if (t === short || t === long) return next === undefined ? null : script(textOf(next));

    if (long !== undefined && t.startsWith(`${long}=`)) return script(t.slice(long.length + 1));
  }

  return null;
}

/** `watch [options] command…`: the words after its options. */
function watchScript(cmd: Cmd, at: number): Script[] {
  let i = at + 1;

  for (let t = textOf(cmd.words[i]); t.startsWith("-"); t = textOf(cmd.words[++i])) if (WATCH_VALUE_OPTS.has(t)) i++;

  return script(lineAfter(cmd.words, i - 1));
}

/** `trap [--] script signal…` at program position: its script. */
function trapScript(cmd: Cmd, at: number): Script[] | null {
  let i = at + 1;

  if (textOf(cmd.words[i]) === END_OF_OPTIONS) i++;
  const word = cmd.words[i];

  return at !== cmd.prog || word === undefined || textOf(word).startsWith("-") ? null : script(textOf(word));
}

/** `git … rebase … -x|--exec cmd`: the command it runs after each commit. */
function rebaseScript(cmd: Cmd, at: number): Script[] | null {
  const rebase = cmd.words.findIndex((w, i) => i > at && textOf(w) === REBASE_SUB);

  return rebase < 0 ? null : optionScript(cmd.words, rebase, EXEC_OPTION);
}

/** Programs with a finder of their own. */
const FINDERS: ReadonlyMap<string, Finder> = /* @__PURE__ */ new Map<string, Finder>([
  ["eval", evalScript],
  ["env", (cmd, at) => optionScript(cmd.words, at, SPLIT_STRING_OPTION)],
  ["watch", watchScript],
  ["trap", trapScript],
  ["source", sourceScript],
  [".", sourceScript],
  ["git", rebaseScript],
]);

/** The finder of the word at `at`: a shell, a program with a command option, one of `FINDERS`, or none. */
function finderOf(cmd: Cmd, at: number, word: ShellWord): Finder | undefined {
  const name = programName(word);

  if (SHELLS.has(name) || (at === cmd.prog && !isLiteral(word))) return shellScripts;

  if (COMMAND_OPTION_PROGRAMS.has(name)) return (c, i) => optionScript(c.words, i, COMMAND_OPTION);

  return FINDERS.get(name);
}

/** The stdin redirects give a command: the last heredoc or here-string, nothing for a file, else `stdin`. */
export function redirectStdin(redirects: readonly Redirect[], stdin: Stdin): Stdin {
  let got = stdin;

  for (const r of redirects) {
    if (r.body !== undefined) got = { kind: "text", text: scriptText(r.body) };
    else if (r.op === "<<<") got = { kind: "text", text: `${scriptText(r.target)}\n` };
    else if (r.op === "<") got = { kind: "none" };
  }

  return got;
}

/** The index of the program word: the first that is not a `NAME=value` assignment. */
export function programAt(words: readonly ShellWord[]): number {
  const at = words.findIndex((w) => !ASSIGNMENT_RE.test(w.raw));

  return at < 0 ? words.length : at;
}

/**
 * The scripts `c` makes bash run, given the stdin a pipe or block feeds it. The first program that runs one decides:
 * a known name anywhere in the words (so `xargs sh -c` counts), or an expanded program word, read as a shell.
 */
export function scriptsOf(c: Simple, stdin: Stdin): Script[] {
  if (c.data !== undefined) return [];
  const cmd: Cmd = { prog: programAt(c.words), stdin: redirectStdin(c.redirects, stdin), words: c.words };

  for (const [at, word] of cmd.words.entries()) {
    const found = at < cmd.prog ? null : (finderOf(cmd, at, word)?.(cmd, at) ?? null);

    if (found !== null) return found;
  }

  return [];
}

/** What a pipe feeds the command after `c`: an `echo` or `printf` line as a script, else opaque, named by program. */
export function pipedStdin(c: Simple): Stdin {
  const prog = programAt(c.words);
  const name = programName(c.words[prog]);

  if (name === "") return { kind: "none" };

  return PRINTERS.has(name) ? { kind: "text", text: `${lineAfter(c.words, prog)}\n` } : { cause: name, kind: "opaque" };
}
