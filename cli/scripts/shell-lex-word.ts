/** Reads one shell word, or a heredoc body, into its literal, expansion and substitution parts. */
import type { Part, ReadWord, ShellWord, WordSpan } from "./shell-ast.types.ts";
import { ansiCEnd, backtickEnd, braceEnd, decodeAnsiC, substitutionEnd } from "./shell-spans.ts";

/**
 * Characters a backslash outside quotes escapes. Before any other, `text` keeps the backslash (a Windows
 * separator).
 */
const ESCAPABLE: ReadonlySet<string> = /* @__PURE__ */ new Set(" \t\n'\"\\$`|&;()<>");

/** Characters a backslash escapes inside double quotes, and inside an unquoted heredoc body. */
const DQ_ESCAPABLE: ReadonlySet<string> = /* @__PURE__ */ new Set('"\\$`\n');
const BODY_ESCAPABLE: ReadonlySet<string> = /* @__PURE__ */ new Set("\\$`\n");

/** Characters that end an unquoted word. */
const WORD_END: ReadonlySet<string> = /* @__PURE__ */ new Set(" \t\n;&|()<>");

const NAME_RE = /^[A-Za-z_]\w*/;

/** The one-character parameters: the special ones and the positional digits. */
const SPECIAL_PARAMS = "@*#?$!-0123456789";

/** A backslash before a backtick, a backslash or a `$` inside backticks, which bash drops. */
const BACKTICK_ESCAPE_RE = /\\([`\\$])/g;

/** A backslash and the character it escapes, or the two characters that open a span. */
const PAIR = 2;

/** `$((` opens arithmetic: the index of its first inner character. */
const ARITH_OPEN = 3;

/** The index `at` takes for the last item. */
const LAST = -1;

/** A read in progress: the text and the parts read from it so far. */
type Reader = { src: string; parts: Part[] };

/** A `$` form read from the text, and the index past it. */
type DollarSpan = { part: Part; end: number };

function addLit(rd: Reader, text: string, bash: string = text): void {
  const last = rd.parts.at(LAST);

  if (last?.kind !== "lit") {
    rd.parts.push({ bash, kind: "lit", text });

    return;
  }

  rd.parts.pop();
  rd.parts.push({ bash: last.bash + bash, kind: "lit", text: last.text + text });
}

/** The `$(…)` bodies a span of text runs: its substitutions, and those inside its expansions. */
function substsIn(text: string): string[] {
  return unquotedBody(text).parts.flatMap((part) => {
    if (part.kind === "subst") return [part.body];

    return part.kind === "param" ? part.substs : [];
  });
}

/** `$((…))` from the `$` at `i`: an expansion, with the substitutions inside it. */
function arithmetic(src: string, i: number): DollarSpan {
  const end = substitutionEnd(src, i + PAIR);
  const substs = substsIn(src.slice(i + ARITH_OPEN, end));

  return { end: end + 1, part: { kind: "param", raw: src.slice(i, end + 1), substs } };
}

/** `$(…)` or `${…}` from the `$` at `i`: a substitution, or an expansion with the substitutions inside it. */
function bracketed(src: string, i: number): DollarSpan {
  const isSubst = src.charAt(i + 1) === "(";
  const end = (isSubst ? substitutionEnd : braceEnd)(src, i + PAIR);
  const raw = src.slice(i, end + 1);
  const inner = src.slice(i + PAIR, end);
  const part: Part = isSubst ? { body: inner, kind: "subst", raw } : { kind: "param", raw, substs: substsIn(inner) };

  return { end: end + 1, part };
}

/** The `$` form at `i` and where it ends: a substitution, arithmetic, or a parameter; null for a literal `$`. */
function dollarAt(src: string, i: number): DollarSpan | null {
  const next = src.charAt(i + 1);

  if (src.startsWith("((", i + 1)) return arithmetic(src, i);

  if (next === "(" || next === "{") return bracketed(src, i);
  const name = NAME_RE.exec(src.slice(i + 1))?.[0] ?? (SPECIAL_PARAMS.includes(next) && next !== "" ? next : "");

  return name === "" ? null : { end: i + 1 + name.length, part: { kind: "param", raw: `$${name}`, substs: [] } };
}

/** A backticked substitution from the backtick at `i`; the index past its close. */
function backticked(rd: Reader, i: number): number {
  const end = backtickEnd(rd.src, i + 1);
  const body = rd.src.slice(i + 1, end).replaceAll(BACKTICK_ESCAPE_RE, "$1");
  rd.parts.push({ body, kind: "subst", raw: rd.src.slice(i, end + 1) });

  return end + 1;
}

/** One character of double-quoted or heredoc text at `at`, where a backslash escapes `escapable`; the next index. */
function quotedChar(rd: Reader, at: number, escapable: ReadonlySet<string>): number {
  const ch = rd.src.charAt(at);
  const next = rd.src.charAt(at + 1);

  if (ch === "\\" && escapable.has(next)) {
    if (next !== "\n") addLit(rd, next);

    return at + PAIR;
  }

  if (ch === "`") return backticked(rd, at);
  const dollar = ch === "$" ? dollarAt(rd.src, at) : null;

  if (dollar === null) {
    addLit(rd, ch);

    return at + 1;
  }

  rd.parts.push(dollar.part);

  return dollar.end;
}

/** A double-quoted span from the quote at `i`, to its close or the end; the index past it. */
function doubleQuoted(rd: Reader, i: number): number {
  let at = i + 1;
  addLit(rd, "");

  while (at < rd.src.length && rd.src[at] !== '"') at = quotedChar(rd, at, DQ_ESCAPABLE);

  return at + 1;
}

/**
 * A backslash outside quotes. A line break after it joins the lines. Before a shell character both spellings drop
 * it; before any other, `text` keeps it (a Windows separator) and bash drops it, so `bun\.lock` is the lockfile.
 */
function backslash(rd: Reader, i: number): number {
  const next = rd.src.charAt(i + 1);

  if (!ESCAPABLE.has(next)) addLit(rd, `\\${next}`, next === "" ? "\\" : next);
  else if (next !== "\n") addLit(rd, next);

  return i + PAIR;
}

/** A `$` outside quotes: `$'…'` decoded, `$"…"` read as double quotes, an expansion, or a literal `$`. */
function unquotedDollar(rd: Reader, i: number): number {
  const next = rd.src.charAt(i + 1);

  if (next === "'") {
    const end = ansiCEnd(rd.src, i + PAIR);
    addLit(rd, decodeAnsiC(rd.src.slice(i + PAIR, end)));

    return end + 1;
  }

  if (next === '"') return doubleQuoted(rd, i + 1);

  return quotedChar(rd, i, ESCAPABLE);
}

/** A `<(…)` or `>(…)` from the `<` or `>` at `i`; the index past its `)`. */
function processSubst(rd: Reader, i: number): number {
  const end = substitutionEnd(rd.src, i + PAIR);
  rd.parts.push({ body: rd.src.slice(i + PAIR, end), kind: "subst", raw: rd.src.slice(i, end + 1) });

  return end + 1;
}

/** True when `src` opens a process substitution at `i`. */
export function opensProcess(src: string, i: number): boolean {
  return (src[i] === "<" || src[i] === ">") && src[i + 1] === "(";
}

/** A single-quoted span from the quote at `at`, to its close or the end; the index past it. */
function singleQuoted(rd: Reader, at: number): number {
  const close = rd.src.indexOf("'", at + 1);
  const end = close < 0 ? rd.src.length : close;
  addLit(rd, rd.src.slice(at + 1, end));

  return end + 1;
}

/** The reader of each character that starts a span outside quotes. */
const SPAN_READERS: ReadonlyMap<string, (rd: Reader, at: number) => number> = /* @__PURE__ */ new Map([
  ["'", singleQuoted],
  ['"', doubleQuoted],
  ["\\", backslash],
  ["`", backticked],
  ["$", unquotedDollar],
]);

/** One unquoted step at `at`; the next index. */
function unquotedAt(rd: Reader, at: number): number {
  const reader = SPAN_READERS.get(rd.src.charAt(at));

  if (reader !== undefined) return reader(rd, at);

  return opensProcess(rd.src, at) ? processSubst(rd, at) : quotedChar(rd, at, ESCAPABLE);
}

/** True when an unquoted word ends at `at`: a blank, an operator, or the CR of a CRLF line break. */
function endsWord(src: string, at: number): boolean {
  const ch = src.charAt(at);

  if (ch === "\r") return src[at + 1] === "\n";

  return WORD_END.has(ch) && !opensProcess(src, at);
}

/** The word that starts at `i`, read to an unquoted blank or operator, and the index past it. */
export function wordAt(src: string, i: number): WordSpan {
  const rd: Reader = { parts: [], src };
  let at = i;

  while (at < src.length && !endsWord(src, at)) at = unquotedAt(rd, at);

  return { end: at, word: { parts: rd.parts, raw: src.slice(i, at) } };
}

/** The body of a heredoc whose delimiter was quoted: literal text. */
export function quotedBody(text: string): ShellWord {
  return { parts: [{ bash: text, kind: "lit", text }], raw: text };
}

/** The body of a heredoc whose delimiter was not quoted: read like double-quoted text, a backslash escaping less. */
export function unquotedBody(text: string): ShellWord {
  const rd: Reader = { parts: [], src: text };

  for (let at = 0; at < text.length;) at = quotedChar(rd, at, BODY_ESCAPABLE);

  return { parts: rd.parts, raw: text };
}

/** The text a child shell gets for `word`: literal parts as bash reads them, and the rest as typed. */
export function scriptText(word: ShellWord): string {
  return word.parts.map((part) => (part.kind === "lit" ? part.bash : part.raw)).join("");
}

/** True when every part of `word` is literal, so `scriptText` is its value. */
export function isLiteral(word: ShellWord): boolean {
  return word.parts.every((part) => part.kind === "lit");
}

/** `word` as a gate judges it; a leading `~` makes it not literal, since bash turns it into a home folder. */
export function readWord(word: ShellWord): ReadWord {
  return { literal: isLiteral(word) && !word.raw.startsWith("~"), raw: word.raw, text: scriptText(word) };
}
