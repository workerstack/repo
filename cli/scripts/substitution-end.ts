/** Where a `$(…)` substitution ends, read as bash reads its body. */
import { braceEnd, pairEnd, PAIR_LENGTH, pastQuoted } from "./shell-spans.ts";
import { LAST } from "./shell.constants.ts";
import { ARM_ENDS, EXTGLOB_LEADS, type Keyword, KEYWORDS, UNPLAIN, WORD_ENDS } from "./substitution-end.constants.ts";

/** Where a `case` inside a substitution stands: before its word, before `in`, in a pattern list, or in an arm. */
type CaseStep = "subject" | "head" | "pattern" | "body";

/** What a word or an operator does to the innermost `case`: open one, close it, move it to a step, or nothing. */
type CaseMove = "open" | "close" | CaseStep | null;

/**
 * A scan of a substitution body: the place, the `(` still open, the `case` commands open around the place, and
 * whether the next word starts a command.
 */
type Scan = { cmd: string; at: number; depth: number; cases: CaseStep[]; command: boolean };

/** What a word does at each step, given its kind and whether it starts a command; `outside` is no open `case`. */
const WORD_MOVES: Readonly<Record<CaseStep | "outside", (kind: Keyword, command: boolean) => CaseMove>> = {
  body: (kind, command) => (command ? commandMove(kind) : null),
  head: (kind) => (kind === "in" ? "pattern" : null),
  outside: (kind, command) => (command && kind === "case" ? "open" : null),
  pattern: (kind) => (kind === "esac" ? "close" : null),
  subject: () => "head",
};

/** What a word that starts a command in a `case` arm does: `case` opens one inside it, `esac` closes it. */
function commandMove(kind: Keyword): CaseMove {
  if (kind === "case") return "open";

  return kind === "esac" ? "close" : null;
}

/** Applies `move` to the open `case` commands. */
function apply(cases: CaseStep[], move: CaseMove): void {
  if (move === "open") cases.push("subject");
  else if (move === "close") cases.pop();
  else if (move !== null) cases[cases.length + LAST] = move;
}

/** The index just past the `$` form at `at`: a whole `$(…)` or `${…}`, else the `$` alone. */
function pastDollar(cmd: string, at: number): number {
  const next = cmd.charAt(at + 1);

  if (next === "(") return substitutionEnd(cmd, at + PAIR_LENGTH) + 1;

  return next === "{" ? braceEnd(cmd, at + PAIR_LENGTH) + 1 : at + 1;
}

/** True when the character at `at` is part of the word that starts at `start`. */
function isInWord(cmd: string, at: number, start: number): boolean {
  const ch = cmd.charAt(at);
  const isExtglob = ch === "(" && at > start && EXTGLOB_LEADS.includes(cmd.charAt(at - 1));

  return at < cmd.length && (isExtglob || !WORD_ENDS.includes(ch));
}

/** The index just past the word character at `at`: a whole quote, `$` form, escape or extended pattern. */
function pastWordChar(cmd: string, at: number): number {
  const ch = cmd.charAt(at);

  if (ch === "(") return pairEnd(cmd, at + 1, "()") + 1;

  if ("'\"`".includes(ch)) return pastQuoted(cmd, at);

  if (ch === "$") return pastDollar(cmd, at);

  return at + (ch === "\\" ? PAIR_LENGTH : 1);
}

/** Reads the word at the place; its kind, which is `other` when a quote, escape or `$` makes it more than text. */
function scanWord(s: Scan): Keyword {
  const start = s.at;
  let isPlain = true;

  while (isInWord(s.cmd, s.at, start)) {
    isPlain &&= !UNPLAIN.includes(s.cmd.charAt(s.at));
    s.at = pastWordChar(s.cmd, s.at);
  }

  const kind = isPlain ? KEYWORDS.get(s.cmd.slice(start, s.at)) : undefined;

  return kind ?? "other";
}

/** Moves the `case` commands on by one word, and sets whether the next word starts a command. */
function onWord(s: Scan, kind: Keyword): void {
  const move = WORD_MOVES[s.cases.at(LAST) ?? "outside"](kind, s.command);
  apply(s.cases, move);
  s.command = move === null && kind === "lead";
}

/** What an operator does to the innermost `case`: a `)` ends a pattern list, an arm end starts the next one. */
function armMove(op: string, top: CaseStep | undefined): CaseMove {
  if (top === "pattern" && op === ")") return "body";

  return top === "body" && ARM_ENDS.some((end) => end === op) ? "pattern" : null;
}

/** Moves past the operator at the place; true when it is the `)` that closes the substitution. */
function onOperator(s: Scan): boolean {
  const op = ARM_ENDS.find((end) => s.cmd.startsWith(end, s.at)) ?? s.cmd.charAt(s.at);
  const top = s.cases.at(LAST);
  const move = armMove(op, top);
  apply(s.cases, move);
  s.at += op.length;
  s.command = !"<>".includes(op);

  if (move !== null || top === "pattern") return false;

  if (op === "(") s.depth++;

  return op === ")" && --s.depth === 0;
}

/**
 * The index of the `)` that closes a `$(` whose body starts at `from`, or the end of `cmd` when none does. It reads
 * the body as bash does: quotes, backticks, escapes and `$` forms whole, each `(` with its own `)`, a `#` that
 * starts a word as a comment to the end of the line, and the `)` after a `case` pattern as part of the `case`.
 */
export function substitutionEnd(cmd: string, from: number): number {
  const s: Scan = { at: from, cases: [], cmd, command: true, depth: 1 };

  while (s.at < cmd.length) {
    const ch = cmd.charAt(s.at);

    if (ch === " " || ch === "\t") s.at++;
    else if (ch === "#") s.at = cmd.includes("\n", s.at) ? cmd.indexOf("\n", s.at) : cmd.length;
    else if (!WORD_ENDS.includes(ch)) onWord(s, scanWord(s));
    else if (onOperator(s)) return s.at + LAST;
  }

  return cmd.length;
}
