/** Reads the tokens of a shell command one at a time for the parser: peeks, matches and consumes them. */
import type { ShellWord, Simple, Token } from "./shell-ast.types.ts";
import { wordOf } from "./shell-lex.ts";

/** Reserved words that end a list in command position, and the operators that do. */
const STOP_WORDS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "then",
  "elif",
  "else",
  "fi",
  "do",
  "done",
  "esac",
  "}",
]);

const STOP_OPS: ReadonlySet<string> = /* @__PURE__ */ new Set([")", ";;", ";&", ";;&"]);
const SEPARATORS: ReadonlySet<string> = /* @__PURE__ */ new Set([";", "\n"]);

/** The tokens being parsed and the index of the next one. */
export type Parser = { tokens: readonly Token[]; i: number };

/** The next token, or undefined at the end. */
export function peek(ps: Parser): Token | undefined {
  return ps.tokens[ps.i];
}

/** True when the next token is the word `raw`. */
export function isWord(ps: Parser, raw: string): boolean {
  return wordOf(peek(ps))?.raw === raw;
}

/** True when the token `ahead` of the next one is the operator `op`. */
export function isOp(ps: Parser, op: string, ahead: number = 0): boolean {
  const t = ps.tokens[ps.i + ahead];

  return t?.kind === "op" && t.op === op;
}

/** Consumes the reserved word or operator `text` when it comes next; whether it did. */
export function take(ps: Parser, text: string): boolean {
  const found = isWord(ps, text) || isOp(ps, text);

  if (found) ps.i++;

  return found;
}

/** Consumes an empty `( )` when it comes next; whether it did. */
export function takeParens(ps: Parser): boolean {
  const found = isOp(ps, "(") && isOp(ps, ")", 1);

  if (found) ps.i += "()".length;

  return found;
}

/** Consumes the line breaks that come next. */
export function skipLines(ps: Parser): void {
  while (isOp(ps, "\n")) ps.i++;
}

/** Consumes the `;` and line breaks that come next. */
export function skipSeparators(ps: Parser): void {
  for (let t = peek(ps); t?.kind === "op" && SEPARATORS.has(t.op); t = peek(ps)) ps.i++;
}

/** True at the end or at a token that closes the list being read. */
export function atStop(ps: Parser): boolean {
  const t = peek(ps);

  if (t === undefined) return true;

  return t.kind === "op" ? STOP_OPS.has(t.op) : t.kind === "word" && STOP_WORDS.has(t.word.raw);
}

/** The words of a head that runs nothing: up to the token `isEnd` stops at, keeping redirect targets as words. */
export function dataWords(ps: Parser, isEnd: (t: Token) => boolean): Simple {
  const words: ShellWord[] = [];

  for (let t = peek(ps); t !== undefined && !isEnd(t); ps.i++, t = peek(ps)) {
    if (t.kind === "word") words.push(t.word);
    else if (t.kind === "redirect") words.push(t.redirect.target);
  }

  return { data: true, kind: "simple", redirects: [], words };
}
