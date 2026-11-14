/** Brace expansion: the words bash makes of `{a,b}` and `{x..y}` before it reads anything else in a word. */
import type { Part, ShellWord } from "./shell-ast.types.ts";
import { LAST } from "./shell.constants.ts";

/** The most words one source word may expand to; past it the gate cannot read the word. */
const MAX_BRACE_WORDS = 1024;

/** `{from..to[..step]}` over whole numbers. */
const NUMBER_SEQUENCE_RE = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/;

/** `{from..to[..step]}` over single letters. */
const LETTER_SEQUENCE_RE = /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$/;

/** A number written with a leading zero, which pads every number of its sequence to one width. */
const PADDED_RE = /^-?0\d/;

/** One unit of a word: a character bash may read as brace syntax, or a part it never does. */
type Atom = { kind: "ch"; ch: string } | { kind: "part"; part: Part };

/** How many words a sequence makes, and the step from one to the next. */
type Steps = { count: number; by: number };

/** Each character of `text` as an atom bash may read as brace syntax. */
function chars(text: string): Atom[] {
  return text.split("").map((ch) => ({ ch, kind: "ch" }));
}

/** The atoms of `word`: each character of unquoted text, and every other part whole. */
function atomsOf(word: ShellWord): Atom[] {
  return word.parts.flatMap((part): Atom[] =>
    part.kind === "lit" && !part.quoted ? chars(part.bash) : [{ kind: "part", part }],
  );
}

/** `atoms` as word parts, each run of characters one unquoted literal. */
function partsOf(atoms: readonly Atom[]): Part[] {
  const parts: Part[] = [];

  for (const atom of atoms) {
    const last = parts.at(LAST);

    if (atom.kind === "part") parts.push(atom.part);
    else if (last?.kind === "lit" && !last.quoted)
      parts[parts.length - 1] = { ...last, bash: last.bash + atom.ch, text: last.text + atom.ch };
    else parts.push({ bash: atom.ch, kind: "lit", quoted: false, text: atom.ch });
  }

  return parts;
}

function isCh(atom: Atom | undefined, ch: string): boolean {
  return atom?.kind === "ch" && atom.ch === ch;
}

/** The index of the `}` that closes the `{` at `open`, and the commas at its own depth; null when none closes it. */
function closeOf(atoms: readonly Atom[], open: number): { close: number; commas: number[] } | null {
  const commas: number[] = [];
  let depth = 0;

  for (let i = open; i < atoms.length; i++) {
    if (isCh(atoms[i], "{")) depth++;
    else if (isCh(atoms[i], ",") && depth === 1) commas.push(i);
    else if (isCh(atoms[i], "}") && --depth === 0) return { close: i, commas };
  }

  return null;
}

/** The text of `atoms` when every one is a character, else null. */
function plainText(atoms: readonly Atom[]): string | null {
  return atoms.every((a): a is Extract<Atom, { kind: "ch" }> => a.kind === "ch")
    ? atoms.map((a) => a.ch).join("")
    : null;
}

/** The count and the step of a sequence from `a` to `b`: bash steps toward `b` by the size of the step typed. */
function stepsOf(a: number, b: number, step: string | undefined): Steps {
  const typed = Math.abs(Number(step ?? 1));
  const size = typed === 0 ? 1 : typed;

  return { by: a <= b ? size : -size, count: Math.floor(Math.abs(b - a) / size) + 1 };
}

/** The words of a `{x..y[..n]}` body (null when it makes more than the cap), or null when it is no sequence. */
function sequenceOf(body: string): { words: string[] | null } | null {
  const m = NUMBER_SEQUENCE_RE.exec(body) ?? LETTER_SEQUENCE_RE.exec(body);

  if (m === null) return null;
  const [, first, last, step] = m;
  const [from, to] = [String(first), String(last)];
  const isNumber = NUMBER_SEQUENCE_RE.test(body);
  const [a, b] = isNumber ? [Number(from), Number(to)] : [from.charCodeAt(0), to.charCodeAt(0)];
  const { count, by } = stepsOf(a, b, step);

  if (count > MAX_BRACE_WORDS) return { words: null };
  const width = [from, to].some((n) => PADDED_RE.test(n)) ? Math.max(from.length, to.length) : 0;

  return {
    words: Array.from({ length: count }, (_, k) =>
      isNumber ? padded(a + k * by, width) : String.fromCharCode(a + k * by),
    ),
  };
}

/** `n` written with at least `width` characters, zeros after any minus sign. */
function padded(n: number, width: number): string {
  return n < 0 ? `-${String(-n).padStart(width - 1, "0")}` : String(n).padStart(width, "0");
}

/**
 * The alternatives a brace at `open` gives (null when a sequence makes more words than the cap), or null when bash
 * reads it as plain text.
 */
function alternatives(atoms: readonly Atom[], open: number): { close: number; alts: Atom[][] | null } | null {
  const found = closeOf(atoms, open);

  if (found === null) return null;
  const { close, commas } = found;

  if (commas.length > 0) {
    const cuts = [open, ...commas, close];

    return { alts: cuts.slice(1).map((cut, k) => atoms.slice(Number(cuts[k]) + 1, cut)), close };
  }

  const body = plainText(atoms.slice(open + 1, close));
  const seq = body === null ? null : sequenceOf(body);
  const alts = seq?.words?.map(chars) ?? null;

  return seq === null ? null : { alts, close };
}

/** Every word `atoms` expand to, left brace first; null past the cap. */
function expandAtoms(atoms: readonly Atom[]): Atom[][] | null {
  for (let open = 0; open < atoms.length; open++) {
    const found = isCh(atoms[open], "{") ? alternatives(atoms, open) : null;

    if (found === null) continue;

    if (found.alts === null) return null;
    const words: Atom[][] = [];

    for (const alt of found.alts) {
      const more = expandAtoms([...atoms.slice(0, open), ...alt, ...atoms.slice(found.close + 1)]);

      if (more === null || words.push(...more) > MAX_BRACE_WORDS) return null;
    }

    return words;
  }

  return [[...atoms]];
}

/**
 * The words bash makes of `word` by brace expansion, each keeping the source word's raw; the word itself when it holds
 * none; null when it makes more than 1,024 words, which the gate cannot read.
 */
export function braceWords(word: ShellWord): ShellWord[] | null {
  const words = expandAtoms(atomsOf(word));

  return words === null ? null : words.map((atoms) => ({ parts: partsOf(atoms), raw: word.raw }));
}
