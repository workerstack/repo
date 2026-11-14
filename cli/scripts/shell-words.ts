/** A quote-aware split of a shell command into its simple commands and their words. */

/** Characters a backslash outside quotes escapes; before any other, the backslash stays (a Windows separator). */
const ESCAPABLE: ReadonlySet<string> = /* @__PURE__ */ new Set(" \t\n'\"\\$`|&;()<>");

/** Characters a backslash inside double quotes escapes. */
const DQ_ESCAPABLE: ReadonlySet<string> = /* @__PURE__ */ new Set('"\\$`\n');

/** A blank or shell operator: a word holding one was quoted or escaped whole, such as an `sh -c` script. */
const HOLDS_COMMAND_RE = /[\s|&;()<>`]/;

/** A backslash and the character it escapes, or `$(`. */
const PAIR_LENGTH = 2;

/** The commands read so far, the words of the open one, and the open word. */
type Lexer = {
  commands: string[][];
  isInWord: boolean;
  word: string;
  words: string[];
};

/** Reads the token at `i` into the lexer and returns the index of the next unread character. */
type Handler = (lx: Lexer, cmd: string, i: number) => number;

function append(lx: Lexer, text: string): void {
  lx.word += text;
  lx.isInWord = true;
}

function endWord(lx: Lexer): void {
  if (lx.isInWord) lx.words.push(lx.word);
  lx.word = "";
  lx.isInWord = false;
}

function endCommand(lx: Lexer): void {
  endWord(lx);

  if (lx.words.length > 0) lx.commands.push(lx.words);
  lx.words = [];
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

/** A double-quoted span with its escapes removed, read to its closing quote or to the end. */
function doubleQuoted(lx: Lexer, cmd: string, i: number): number {
  let text = "";
  let at = i + 1;

  while (at < cmd.length && cmd[at] !== '"') {
    const escaped = cmd[at] === "\\" && DQ_ESCAPABLE.has(cmd.charAt(at + 1));
    text += escaped ? cmd.charAt(at + 1) : cmd.charAt(at);
    at += escaped ? PAIR_LENGTH : 1;
  }

  append(lx, text);

  return at + 1;
}

function backslash(lx: Lexer, cmd: string, i: number): number {
  if (!ESCAPABLE.has(cmd.charAt(i + 1))) return literal(lx, cmd, i);
  append(lx, cmd.charAt(i + 1));

  return i + PAIR_LENGTH;
}

/** `$(` opens a command; any other `$` is part of the word. */
function dollar(lx: Lexer, cmd: string, i: number): number {
  if (cmd[i + 1] !== "(") return literal(lx, cmd, i);
  endCommand(lx);

  return i + PAIR_LENGTH;
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
  ["`", commandEnd],
  [" ", wordEnd],
  ["\t", wordEnd],
  ["<", wordEnd],
  [">", wordEnd],
]);

/**
 * The simple commands of `cmd`, each as its words with quotes and escapes removed. Outside quotes, `|`, `||`, `&&`,
 * `&` (not in `>&` or `&>`), `;`, newlines, `(`, `)`, `$(` and backticks end a command; blanks, `<` and `>` end a
 * word. An unclosed quote reads to the end as one word.
 */
export function simpleCommands(cmd: string): string[][] {
  const lx: Lexer = { commands: [], isInWord: false, word: "", words: [] };
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
