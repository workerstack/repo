/**
 * Builds the command tree bash would run from the tokens of a shell command. It never fails: an unclosed construct
 * closes at the end and a stray closer is skipped, so a walk of the tree sees at least every command bash runs.
 */
import type { Redirect, ShellNode, ShellWord, Simple, Token } from "./shell-ast.types.ts";
import { wordOf } from "./shell-lex.ts";
import type { Parser } from "./shell-parse-cursor.ts";
import {
  atStop,
  dataWords,
  isOp,
  isWord,
  peek,
  skipLines,
  skipSeparators,
  take,
  takeParens,
} from "./shell-parse-cursor.ts";

const ARM_ENDS: readonly string[] = [";;", ";&", ";;&"];

const EMPTY: ShellNode = { items: [], kind: "seq" };

/** The one node of `items`, or a seq of them. */
function seqOf(items: ShellNode[]): ShellNode {
  const [only] = items;

  return items.length === 1 && only !== undefined ? only : { items, kind: "seq" };
}

/** Commands to the next closer: `;`, newlines and `&` separate them, `&` sends the one before it off. */
function list(ps: Parser): ShellNode {
  const items: ShellNode[] = [];

  for (;;) {
    skipSeparators(ps);

    if (atStop(ps)) return seqOf(items);
    const node = andOr(ps);
    items.push(take(ps, "&") ? { body: node, kind: "async" } : node);
  }
}

function andOr(ps: Parser): ShellNode {
  let node = pipeline(ps);

  for (;;) {
    const op = ["&&", "||"].find((o) => isOp(ps, o));

    if (op === undefined) return node;
    ps.i++;
    skipLines(ps);
    const next = pipeline(ps);
    node = op === "&&" ? { items: [node, next], kind: "seq" } : { kind: "or", left: node, right: next };
  }
}

function pipeline(ps: Parser): ShellNode {
  for (;;) {
    if (take(ps, "time")) take(ps, "-p");
    else if (!take(ps, "!")) break;
  }

  const items: [ShellNode, ...ShellNode[]] = [command(ps)];

  while (take(ps, "|") || take(ps, "|&")) {
    skipLines(ps);
    items.push(command(ps));
  }

  const [only, ...rest] = items;

  return rest.length === 0 ? only : { items, kind: "pipe" };
}

/** A compound command with the redirects written after it. */
function withRedirects(ps: Parser, node: ShellNode): ShellNode {
  const redirects: Redirect[] = [];

  for (let t = peek(ps); t?.kind === "redirect"; ps.i++, t = peek(ps)) redirects.push(t.redirect);

  return redirects.length === 0 ? node : { body: node, kind: "redir", redirects };
}

function simple(ps: Parser): ShellNode {
  const words: ShellWord[] = [];
  const redirects: Redirect[] = [];

  for (let t = peek(ps); t?.kind === "word" || t?.kind === "redirect"; ps.i++, t = peek(ps)) {
    if (t.kind === "word") words.push(t.word);
    else redirects.push(t.redirect);
  }

  const [name] = words;

  if (name !== undefined && words.length === 1 && redirects.length === 0 && takeParens(ps))
    return funcBody(ps, name.raw);

  return { kind: "simple", redirects, words };
}

function funcBody(ps: Parser, name: string): ShellNode {
  skipLines(ps);

  return { body: command(ps), kind: "func", name };
}

/** `( list )` or `{ list; }`; a group keeps its state, so it is its list. */
function block(ps: Parser, close: string): ShellNode {
  ps.i++;
  const body = list(ps);
  take(ps, close);

  return close === ")" ? { body, kind: "subshell" } : body;
}

/** `if` or `elif` on: condition, `then` branch, and the `elif` or `else` after it, to `fi`. */
function ifRest(ps: Parser): ShellNode {
  ps.i++;
  const cond = list(ps);
  take(ps, "then");
  const body = list(ps);

  if (isWord(ps, "elif")) return { body, cond, kind: "if", orElse: ifRest(ps) };
  const orElse = take(ps, "else") ? list(ps) : null;
  take(ps, "fi");

  return orElse === null ? { body, cond, kind: "if" } : { body, cond, kind: "if", orElse };
}

/** The list of `do list done` after a loop head. */
function doBody(ps: Parser): ShellNode {
  skipSeparators(ps);
  take(ps, "do");
  const body = list(ps);
  take(ps, "done");

  return body;
}

function loopBody(ps: Parser, cond: ShellNode): ShellNode {
  return { body: doBody(ps), cond, kind: "loop" };
}

function whileLoop(ps: Parser): ShellNode {
  ps.i++;

  return loopBody(ps, list(ps));
}

/** The words of an arithmetic `(( … ))` head, up to the `)` that closes its first `(`. */
function arithHead(ps: Parser): Simple {
  let depth = 0;

  return dataWords(ps, (t) => {
    if (t.kind !== "op") return false;

    if (t.op === "(") depth++;
    else if (t.op === ")") depth--;

    return depth === 0;
  });
}

/** `for (( … ))` and its body: a loop whose head's words are data. */
function arithFor(ps: Parser): ShellNode {
  const head = arithHead(ps);
  take(ps, ")");

  return { items: [head, loopBody(ps, EMPTY)], kind: "seq" };
}

/**
 * `for name [in words]` or `select name [in words]`, then its body; the words are data, and `"$@"` (null) without
 * `in`.
 */
function forLoop(ps: Parser): ShellNode {
  const isSelect = isWord(ps, "select");
  ps.i++;

  if (isOp(ps, "(")) return arithFor(ps);
  const name = wordOf(peek(ps))?.raw ?? "";
  ps.i++;
  skipLines(ps);
  const words = take(ps, "in") ? dataWords(ps, (t) => t.kind === "op") : null;
  const body = doBody(ps);

  return isSelect ? { body, kind: "for", name, select: true, words } : { body, kind: "for", name, words };
}

/** `case word in (pattern | …) list ;; … esac`; the word is data and each arm a branch. */
function caseClause(ps: Parser): ShellNode {
  ps.i++;
  const word = dataWords(ps, (t) => t.kind !== "word" || isWord(ps, "in"));
  take(ps, "in");
  const arms: ShellNode[] = [];

  for (skipLines(ps); peek(ps) !== undefined && !isWord(ps, "esac"); skipLines(ps)) {
    take(ps, "(");
    dataWords(ps, (t) => !(t.kind === "word" || isOp(ps, "|")));

    if (!take(ps, ")")) break;
    arms.push(list(ps));
    ARM_ENDS.some((end) => take(ps, end));
  }

  take(ps, "esac");

  return { arms, kind: "case", word };
}

/** `function name [()] body`. */
function funcKeyword(ps: Parser): ShellNode {
  ps.i++;
  const name = wordOf(peek(ps))?.raw ?? "";
  ps.i++;

  takeParens(ps);

  return funcBody(ps, name);
}

/** `[[ … ]]`: one command whose words are the test's words, operators inside it skipped. */
function testCommand(ps: Parser): ShellNode {
  const test = dataWords(ps, () => isWord(ps, "]]") || isOp(ps, ";") || isOp(ps, "\n"));
  take(ps, "]]");

  return { kind: "simple", redirects: [], words: test.words };
}

const COMPOUNDS: ReadonlyMap<string, (ps: Parser) => ShellNode> = /* @__PURE__ */ new Map([
  ["(", (ps: Parser) => block(ps, ")")],
  ["{", (ps: Parser) => block(ps, "}")],
  ["if", ifRest],
  ["while", whileLoop],
  ["until", whileLoop],
  ["for", forLoop],
  ["select", forLoop],
  ["case", caseClause],
  ["function", funcKeyword],
  ["[[", testCommand],
]);

function command(ps: Parser): ShellNode {
  const t = peek(ps);
  const key = t?.kind === "op" ? t.op : wordOf(t)?.raw;
  const compound = key === undefined ? undefined : COMPOUNDS.get(key);

  return compound === undefined ? simple(ps) : withRedirects(ps, compound(ps));
}

/** The command tree of `tokens`; a stray closer between lists is skipped. */
export function shellParse(tokens: readonly Token[]): ShellNode {
  const ps: Parser = { i: 0, tokens };
  const items: ShellNode[] = [];

  while (ps.i < tokens.length) {
    items.push(list(ps));
    ps.i++;
  }

  return seqOf(items);
}
