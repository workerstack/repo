/** A quote-aware split of a shell command into its simple commands and their words. */
import { ansiCEnd, backtickEnd, decodeAnsiC, substitutionEnd } from "./shell-spans.ts";

/** Characters a backslash outside quotes escapes; before any other, the backslash stays (a Windows separator). */
const ESCAPABLE: ReadonlySet<string> = /* @__PURE__ */ new Set(" \t\n'\"\\$`|&;()<>");

/** Characters a backslash inside double quotes escapes. */
const DQ_ESCAPABLE: ReadonlySet<string> = /* @__PURE__ */ new Set('"\\$`\n');

/** A blank or shell operator: a word holding one was quoted or escaped whole, such as an `sh -c` script. */
const HOLDS_COMMAND_RE = /[\s|&;()<>`]/;

/** A backslash and the character it escapes, or `$(`. */
const PAIR_LENGTH = 2;

/** The character after a `$` that makes it a parameter expansion: a name, a digit, `{` or a special parameter. */
const PARAMETER_RE = /[\w{@*#?$!-]/;

/** A backslash before a backtick, a backslash or a `$` inside backticks, which bash drops. */
const BACKTICK_ESCAPE_RE = /\\([`\\$])/g;

/**
 * A simple command: its words; each word as bash reads it, which drops a backslash outside quotes that `words` keeps
 * for a Windows path and decodes `$'…'`; the indices of the words a `<` or `>` redirects to or from; and the indices
 * of the words that hold an expansion (`$name`, `${…}`, `$(…)` or a backtick), whose value the gate cannot know.
 */
export type ShellCommand = {
  bashWords: string[];
  expanded: ReadonlySet<number>;
  redirects: ReadonlySet<number>;
  words: string[];
};

/**
 * The commands read so far, the open command's words, their bash reading, redirect targets and expanded words, the
 * open word in both readings, whether it holds an expansion, and whether the next word is a redirect target.
 */
type Lexer = {
  bash: string;
  bashWords: string[];
  commands: ShellCommand[];
  expanded: Set<number>;
  isExpanded: boolean;
  isInWord: boolean;
  isRedirectNext: boolean;
  redirects: Set<number>;
  word: string;
  words: string[];
};

/** Reads the token at `i` into the lexer and returns the index of the next unread character. */
type Handler = (lx: Lexer, cmd: string, i: number) => number;

/** Adds `text` to the open word, read by bash as `bash`. */
function append(lx: Lexer, text: string, bash: string = text): void {
  lx.word += text;
  lx.bash += bash;
  lx.isInWord = true;
}

function endWord(lx: Lexer): void {
  if (lx.isInWord) {
    if (lx.isRedirectNext) lx.redirects.add(lx.words.length);

    if (lx.isExpanded) lx.expanded.add(lx.words.length);
    lx.isRedirectNext = false;
    lx.words.push(lx.word);
    lx.bashWords.push(lx.bash);
  }

  lx.word = "";
  lx.bash = "";
  lx.isInWord = false;
  lx.isExpanded = false;
}

function endCommand(lx: Lexer): void {
  endWord(lx);
  const { bashWords, expanded, redirects, words } = lx;

  if (words.length > 0) lx.commands.push({ bashWords, expanded, redirects, words });
  lx.words = [];
  lx.bashWords = [];
  lx.redirects = new Set<number>();
  lx.expanded = new Set<number>();
  lx.isRedirectNext = false;
}

/**
 * Reads the commands of a `$(…)` or backtick body as commands of their own, and leaves an empty piece of unknown
 * value in the open word, so the words around the substitution stay in the command that holds it.
 */
function substituted(lx: Lexer, body: string): void {
  lx.commands.push(...simpleCommands(body));
  append(lx, "");
  lx.isExpanded = true;
}

/** `$(…)` from the `$` at `i`, read to its `)` or to the end. */
function substitution(lx: Lexer, cmd: string, i: number): number {
  const end = substitutionEnd(cmd, i + PAIR_LENGTH);
  substituted(lx, cmd.slice(i + PAIR_LENGTH, end));

  return end + 1;
}

/** A backticked substitution from the backtick at `i`, read to its closing backtick or to the end. */
function backticked(lx: Lexer, cmd: string, i: number): number {
  const end = backtickEnd(cmd, i + 1);
  substituted(lx, cmd.slice(i + 1, end).replaceAll(BACKTICK_ESCAPE_RE, "$1"));

  return end + 1;
}

/** The `$` of a parameter expansion: kept in the word, which now holds a value the gate cannot know. */
function parameter(lx: Lexer, cmd: string, i: number): number {
  lx.isExpanded = true;

  return literal(lx, cmd, i);
}

function literal(lx: Lexer, cmd: string, i: number): number {
  append(lx, cmd.charAt(i));

  return i + 1;
}

/** A single-quoted span, literal to its closing quote or to the end when it never closes. */
function singleQuoted(lx: Lexer, cmd: string, i: number): number {
  const at = cmd.indexOf("'", i + 1);
  const end = at < 0 ? cmd.length : at;
  append(lx, cmd.slice(i + 1, end));

  return end + 1;
}

/** One character of a double-quoted span at `at`: an escape, a substitution, an expansion or a literal. */
function inDoubleQuotes(lx: Lexer, cmd: string, at: number): number {
  const ch = cmd.charAt(at);
  const next = cmd.charAt(at + 1);

  if (ch === "\\" && DQ_ESCAPABLE.has(next)) {
    append(lx, next);

    return at + PAIR_LENGTH;
  }

  if (ch === "`") return backticked(lx, cmd, at);

  if (ch === "$" && next === "(") return substitution(lx, cmd, at);

  return ch === "$" && PARAMETER_RE.test(next) ? parameter(lx, cmd, at) : literal(lx, cmd, at);
}

/** A double-quoted span with its escapes removed, read to its closing quote or to the end. */
function doubleQuoted(lx: Lexer, cmd: string, i: number): number {
  let at = i + 1;
  append(lx, "");

  while (at < cmd.length && cmd[at] !== '"') at = inDoubleQuotes(lx, cmd, at);

  return at + 1;
}

/**
 * A backslash outside quotes. Before a shell character both readings drop it. Before any other, `words` keeps it (a
 * Windows separator) and bash drops it, so `bun\.lock` is the lockfile to bash.
 */
function backslash(lx: Lexer, cmd: string, i: number): number {
  const next = cmd.charAt(i + 1);

  if (ESCAPABLE.has(next)) append(lx, next);
  else append(lx, `\\${next}`, next === "" ? "\\" : next);

  return i + PAIR_LENGTH;
}

/** An ANSI-C `$'…'` span from the `$` at `i`, decoded in both readings. */
function ansiC(lx: Lexer, cmd: string, i: number): number {
  const end = ansiCEnd(cmd, i + PAIR_LENGTH);
  const text = decodeAnsiC(cmd.slice(i + PAIR_LENGTH, end));
  append(lx, text);

  return end + 1;
}

/**
 * `$(` and `$'` open a span; `$"` is a double-quoted span; a `$` before a name, a digit, `{` or a special parameter is
 * an expansion; any other `$` is part of the word.
 */
function dollar(lx: Lexer, cmd: string, i: number): number {
  const next = cmd.charAt(i + 1);

  if (next === "(") return substitution(lx, cmd, i);

  if (next === "'") return ansiC(lx, cmd, i);

  if (next === '"') return i + 1;

  return PARAMETER_RE.test(next) ? parameter(lx, cmd, i) : literal(lx, cmd, i);
}

/** `>&` and `&>` are redirects inside one command; any other `&` ends the command. */
function ampersand(lx: Lexer, cmd: string, i: number): number {
  if (cmd[i - 1] === ">" || cmd[i + 1] === ">") endWord(lx);
  else endCommand(lx);

  return i + 1;
}

function commandEnd(lx: Lexer, _cmd: string, i: number): number {
  endCommand(lx);

  return i + 1;
}

function wordEnd(lx: Lexer, _cmd: string, i: number): number {
  endWord(lx);

  return i + 1;
}

/** `<` or `>` ends the open word, and the next word is the file it reads or writes. */
function redirect(lx: Lexer, _cmd: string, i: number): number {
  endWord(lx);
  lx.isRedirectNext = true;

  return i + 1;
}

const HANDLERS: ReadonlyMap<string, Handler> = /* @__PURE__ */ new Map<string, Handler>([
  ["'", singleQuoted],
  ['"', doubleQuoted],
  ["\\", backslash],
  ["$", dollar],
  ["&", ampersand],
  ["|", commandEnd],
  [";", commandEnd],
  ["\n", commandEnd],
  ["(", commandEnd],
  [")", commandEnd],
  ["`", backticked],
  [" ", wordEnd],
  ["\t", wordEnd],
  ["<", redirect],
  [">", redirect],
]);

/**
 * The simple commands of `cmd` (see {@link ShellCommand}), with quotes and escapes removed. Outside quotes, `|`, `||`,
 * `&&`, `&` (not in `>&` or `&>`), `;`, newlines, `(` and `)` end a command; blanks, `<` and `>` end a word. The body
 * of a `$(…)` or backtick substitution, in or out of double quotes, adds its own commands and leaves the one around
 * it whole. An unclosed quote or substitution reads to the end.
 */
export function simpleCommands(cmd: string): ShellCommand[] {
  const lx: Lexer = {
    bash: "",
    bashWords: [],
    commands: [],
    expanded: new Set<number>(),
    isExpanded: false,
    isInWord: false,
    isRedirectNext: false,
    redirects: new Set<number>(),
    word: "",
    words: [],
  };

  let i = 0;

  while (i < cmd.length) i = (HANDLERS.get(cmd.charAt(i)) ?? literal)(lx, cmd, i);
  endCommand(lx);

  return lx.commands;
}

/**
 * True when a word of {@link simpleCommands} holds a blank or a shell operator, so it reads as a command of its own.
 * Such a word lost the quotes or escapes that kept it whole, so it is shorter than the command it came from.
 */
export function holdsCommand(word: string): boolean {
  return HOLDS_COMMAND_RE.test(word);
}
