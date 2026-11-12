/** The `.gitignore` edit a simple shell write makes: echo, printf, cat or tee, redirected or piped, or a heredoc. */
import {
  APPEND_OP,
  CAT,
  DEV_NULL,
  ECHO,
  ECHO_FLAGS_RE,
  ESCAPE_RE,
  ESCAPES,
  EXPANDS_RE,
  HEREDOC_RE,
  LEADING_TABS_RE,
  NOT_FOUND,
  PERCENT_ESCAPE,
  PIPE_OP,
  PRINTF,
  REDIRECT_TOKENS,
  TEE,
  TEE_APPEND,
  TRAILING_SPACE_RE,
  UNSAFE_CHAR,
  WRITE_OP,
} from "./gitignore-guard.constants.ts";
import type { IgnoreEdit, ShellParts, ShellToken, ShellWrite } from "./gitignore-guard.types.ts";
import { ignoreEdit, ignoreTarget, linesOf } from "./ignore-edits.ts";

/** A shell line being read: the tokens so far and the word being built (null between words). */
type Lexer = { line: string; out: ShellToken[]; word: string | null };

function endWord(lx: Lexer): void {
  if (lx.word !== null) lx.out.push({ word: lx.word });
  lx.word = null;
}

/** A quote at `i`: its text joins the word; null when it does not close or would expand. */
function quoted(lx: Lexer, i: number, quote: string): number | null {
  const close = lx.line.indexOf(quote, i + 1);

  if (close === NOT_FOUND) return null;
  const inner = lx.line.slice(i + 1, close);

  if (quote === '"' && EXPANDS_RE.test(inner)) return null;
  lx.word = (lx.word ?? "") + inner;

  return close;
}

function redirect(lx: Lexer, i: number): number {
  endWord(lx);
  const isAppend = lx.line[i + 1] === WRITE_OP;
  lx.out.push({ op: isAppend ? APPEND_OP : WRITE_OP });

  return isAppend ? i + 1 : i;
}

/** Reads the char at `i`; returns the index of the last char it used, or null when the line is not literal. */
function step(lx: Lexer, i: number): number | null {
  const ch = lx.line.charAt(i);

  if (ch === " " || ch === "\t") {
    endWord(lx);

    return i;
  }

  if (ch === WRITE_OP) return redirect(lx, i);

  if (ch === PIPE_OP) {
    if (lx.line[i + 1] === PIPE_OP) return null;
    endWord(lx);
    lx.out.push({ op: PIPE_OP });

    return i;
  }

  if (ch === "'" || ch === '"') return quoted(lx, i, ch);

  if (UNSAFE_CHAR.test(ch)) return null;
  lx.word = (lx.word ?? "") + ch;

  return i;
}

/** Words and `>`/`>>`/`|` of one shell line; null on anything a plain parse cannot read literally. */
function shellTokens(line: string): ShellToken[] | null {
  const lx: Lexer = { line, out: [], word: null };
  let i = 0;

  while (i < line.length) {
    const last = step(lx, i);

    if (last === null) return null;
    i = last + 1;
  }

  endWord(lx);

  return lx.out;
}

function unescape(s: string): string {
  return s.replaceAll(ESCAPE_RE, (_: string, c: string) => ESCAPES.get(c) ?? c);
}

function printfText(args: string[]): string | null {
  const [format, ...extra] = args;

  if (format === undefined || extra.length > 0 || format.replaceAll(PERCENT_ESCAPE, "").includes("%")) return null;

  return unescape(format.replaceAll(PERCENT_ESCAPE, "%"));
}

function echoText(args: string[]): string | null {
  const at = args.findIndex((a) => !ECHO_FLAGS_RE.test(a));
  const split = at === NOT_FOUND ? args.length : at;
  const flags = args.slice(0, split).join("");
  const body = args.slice(split).join(" ");
  const isEscaped = flags.includes("e");

  if (!isEscaped && body.includes("\\")) return null;

  return (isEscaped ? unescape(body) : body) + (flags.includes("n") ? "" : "\n");
}

/** The text `echo` or `printf` prints, or null when it depends on anything but its literal words. */
function producedText(words: string[]): string | null {
  const [cmd, ...args] = words;

  if (cmd === PRINTF) return printfText(args);

  return cmd === ECHO ? echoText(args) : null;
}

/** True when `tail` is empty or is `> /dev/null`. */
function isQuietTail(tail: ShellToken[]): boolean {
  if (tail.length === 0) return true;
  const [op, sink, ...more] = tail;

  return op?.op === WRITE_OP && sink?.word === DEV_NULL && more.length === 0;
}

/** `tee [-a] FILE [> /dev/null]` at `tokens`; null when the tokens are anything else. */
function teeTarget(tokens: ShellToken[]): { file: string; append: boolean } | null {
  const [head, ...rest] = tokens;

  if (head?.word !== TEE) return null;
  const isAppend = rest[0]?.word === TEE_APPEND;
  const [target, ...tail] = isAppend ? rest.slice(1) : rest;
  const file = target?.word;

  if (file === undefined || file === "") return null;

  return isQuietTail(tail) ? { append: isAppend, file } : null;
}

function stripTabs(line: string, dash: string): string {
  return dash === "" ? line : line.replace(LEADING_TABS_RE, "");
}

/** The command's first line with the heredoc operator cut out, and the body; null when the body is not literal. */
function heredocParts(head: string, rest: string[], doc: RegExpExecArray): ShellParts | null {
  const [whole, dash, quote, tag] = [...doc] /* every group matches, maybe empty */ as [string, string, string, string];
  const bodyLines = rest.map((l) => stripTabs(l, dash));
  const closing = bodyLines.pop();

  if (closing === undefined || closing.trim() !== tag) return null;

  if (quote === "" && bodyLines.some((l) => EXPANDS_RE.test(l))) return null;
  const cut = `${head.slice(0, doc.index)} ${head.slice(doc.index + whole.length)}`;

  return { body: bodyLines.map((l) => `${l}\n`).join(""), head: cut };
}

/** A one-line command, or a command whose further lines are its heredoc; null for any other multi-line command. */
function shellParts(command: unknown): ShellParts | null {
  const [head, ...rest] = String(command).replace(TRAILING_SPACE_RE, "").split("\n") /* split yields one or more */ as [
    string,
    ...string[],
  ];

  const doc = HEREDOC_RE.exec(head);

  if (doc !== null) return heredocParts(head, rest, doc);

  return rest.length > 0 ? null : { body: null, head };
}

function producerEnd(pipe: number, redirectAt: number, length: number): number {
  if (pipe !== NOT_FOUND) return pipe;

  return redirectAt === NOT_FOUND ? length : redirectAt;
}

/** The text a `cat` of the heredoc, an `echo` or a `printf` writes; null for any other producer. */
function producerText(words: string[], body: string | null): string | null {
  if (words[0] === CAT) return words.length === 1 ? body : null;

  return body === null ? producedText(words) : null;
}

/** `> FILE` or `>> FILE` at `redirectAt` as the last tokens; null for anything else. */
function redirectWrite(tokens: ShellToken[], redirectAt: number, text: string): ShellWrite | null {
  const rest = tokens.slice(redirectAt);
  const file = rest[1]?.word;

  if (redirectAt === NOT_FOUND || rest.length !== REDIRECT_TOKENS || file === undefined || file === "") return null;

  return { append: rest[0]?.op === APPEND_OP, file, text };
}

function teeWrite(tokens: ShellToken[], text: string | null): ShellWrite | null {
  if (text === null) return null;
  const tee = teeTarget(tokens);

  return tee === null ? null : { ...tee, text };
}

/** One shell write of literal text to one file, in the forms D4 names; null for every other command. */
function shellIgnoreWrite(command: unknown): ShellWrite | null {
  const parts = shellParts(command);
  const tokens = parts === null ? null : shellTokens(parts.head);

  if (parts === null || tokens === null || tokens.length === 0) return null;
  const pipe = tokens.findIndex((t) => t.op === PIPE_OP);
  const redirectAt = tokens.findIndex((t) => t.op === WRITE_OP || t.op === APPEND_OP);
  const producer = tokens.slice(0, producerEnd(pipe, redirectAt, tokens.length));

  if (producer.some((t) => t.op !== undefined)) return null;
  const words = producer.map((t) => t.word /* no operators remain in producer */ as string);

  if (words[0] === TEE) return teeWrite(tokens, parts.body);
  const text = producerText(words, parts.body);

  if (text === null) return null;

  return pipe === NOT_FOUND ? redirectWrite(tokens, redirectAt, text) : teeWrite(tokens.slice(pipe + 1), text);
}

/** The edit a simple shell redirect makes to a `.gitignore`; [] for every other command. */
export function shellIgnoreEdits(command: unknown, cwd: string): IgnoreEdit[] {
  const w = shellIgnoreWrite(command);
  const file = w === null ? null : ignoreTarget(w.file, cwd);

  return w === null || file === null ? [] : [ignoreEdit(file, linesOf(w.text))];
}
