/** Splits a shell command into words, operators and redirects, with each heredoc body attached to its redirect. */
import type { Redirect, ShellWord, Token } from "./shell-ast.types.ts";
import { opensProcess, quotedBody, scriptText, unquotedBody, wordAt } from "./shell-lex-word.ts";

/** Control operators, longest first. */
const OPERATORS = [";;&", ";;", ";&", "&&", "||", "|&", ";", "&", "|", "(", ")"] as const;

/** Redirect operators, longest first, after an optional fd number. */
const REDIRECTS = ["&>>", "<<<", "<<-", "&>", ">>", ">|", ">&", "<&", "<>", "<<", "<", ">"] as const;

const FD_RE = /^\d+(?=[<>])/;
const HEREDOC_OPS: ReadonlySet<string> = /* @__PURE__ */ new Set(["<<", "<<-"]);
const BLANKS = " \t";
const QUOTING_RE = /['"\\]/;
const LEADING_TABS = /^\t+/;
const CR_AT_END = /\r$/;

/** A backslash and the line break it joins. */
const LINE_JOIN = "\\\n";

/** The lexer's place: the text, the tokens so far, and the heredocs whose bodies start at the next line. */
type Lexer = { src: string; tokens: Token[]; pending: Redirect[] };

/** The index of the line break at or after `i`, or the end. */
function lineEnd(src: string, i: number): number {
  const at = src.indexOf("\n", i);

  return at < 0 ? src.length : at;
}

/** One heredoc body from `from`, to its delimiter line or the end; the index past that line. */
function readBody(lx: Lexer, redirect: Redirect, from: number): number {
  const delimiter = scriptText(redirect.target);
  const isIndented = redirect.op === "<<-";
  const lines: string[] = [];
  let at = from;

  while (at < lx.src.length) {
    const end = lineEnd(lx.src, at);
    const raw = lx.src.slice(at, end).replace(CR_AT_END, "");
    const line = isIndented ? raw.replace(LEADING_TABS, "") : raw;
    at = end + 1;

    if (line === delimiter) break;
    lines.push(line);
  }

  const text = lines.map((line) => `${line}\n`).join("");
  redirect.body = QUOTING_RE.test(redirect.target.raw) ? quotedBody(text) : unquotedBody(text);

  return at;
}

/** A redirect from `i`: its operator, an optional fd before it, and the word after it; the index past that word. */
function redirectAt(lx: Lexer, i: number, op: string): number {
  let at = i + op.length;

  while (BLANKS.includes(lx.src.charAt(at)) && at < lx.src.length) at++;
  const { word, end } = wordAt(lx.src, at);
  const redirect: Redirect = { op, target: word };
  lx.tokens.push({ kind: "redirect", redirect });

  if (HEREDOC_OPS.has(op)) lx.pending.push(redirect);

  return end;
}

/** The redirect operator at `i` with its fd, or null. */
function redirectOp(src: string, i: number): { op: string; at: number } | null {
  const fd = FD_RE.exec(src.slice(i))?.[0] ?? "";
  const op = REDIRECTS.find((r) => src.startsWith(r, i + fd.length));

  return op === undefined ? null : { at: i + fd.length, op };
}

/** A line break at `i`, then the bodies of the heredocs opened on its line; the index past the last body. */
function lineBreak(lx: Lexer, i: number): number {
  lx.tokens.push({ kind: "op", op: "\n" });
  let at = i + 1;

  for (const redirect of lx.pending.splice(0)) at = readBody(lx, redirect, at);

  return at;
}

/** One token from `i`, or a skipped blank, line join or comment; the next index. */
function step(lx: Lexer, i: number): number {
  const { src } = lx;
  const ch = src.charAt(i);

  if (BLANKS.includes(ch) || (ch === "\r" && src[i + 1] === "\n")) return i + 1;

  if (src.startsWith(LINE_JOIN, i)) return i + LINE_JOIN.length;

  if (ch === "#") return lineEnd(src, i);

  if (ch === "\n") return lineBreak(lx, i);

  const redirect = opensProcess(src, i) ? null : redirectOp(src, i);

  if (redirect !== null) return redirectAt(lx, redirect.at, redirect.op);
  const op = OPERATORS.find((o) => src.startsWith(o, i));

  if (op !== undefined) {
    lx.tokens.push({ kind: "op", op });

    return i + op.length;
  }

  const { word, end } = wordAt(src, i);
  lx.tokens.push({ kind: "word", word });

  return end;
}

/**
 * The tokens of `src`: words, control operators (a line break is `\n`) and redirects with the word they name. A `#` at
 * a word start comments out the rest of the line. A heredoc's body is read from the line after its operator, in order,
 * and attached to its redirect; an unclosed one reads to the end.
 */
export function lex(src: string): Token[] {
  const lx: Lexer = { pending: [], src, tokens: [] };
  let i = 0;

  while (i < src.length) i = step(lx, i);

  return lx.tokens;
}

/** The word of a word token, or null for any other. */
export function wordOf(token: Token | undefined): ShellWord | null {
  return token?.kind === "word" ? token.word : null;
}
