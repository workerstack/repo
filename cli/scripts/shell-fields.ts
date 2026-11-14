/** A simple command as the words bash runs: each word expanded into its fields, globs matched on disk. */
import type path from "node:path";

import { globMatches } from "./glob-matches.ts";
import type { Part, ReadWord, Redirect, Scope, ShellWord, Simple, Value } from "./shell-ast.types.ts";
import { expandFields, expandValue } from "./shell-expand.ts";
import { type GlobToken, globText, globTokens } from "./shell-glob.ts";
import { programAt, programBase } from "./shell-scripts.ts";
import { ASSIGNMENT_RE, DATA_REDIRECTS, SETTERS } from "./shell.constants.ts";

/**
 * A field built in `readWord`: its bash text, the path gate's two spellings, the known text before each unknown part
 * (`done`), and the known text since the last one (`open`).
 */
type Acc = { text: string; pathText: string; pathBash: string; done: string[]; open: string };

function quotedField(text: string, raw: string, bash: string = text): ShellWord {
  return { parts: [{ bash, kind: "lit", quoted: true, text }], raw };
}

/** A field whose pattern matched nothing, as bash leaves it: its text as typed, which no later step reads as a glob. */
function asTyped(field: ShellWord): ShellWord {
  const read = readWord(field);

  return quotedField(read.pathText, field.raw, read.text);
}

/** `field` after filename expansion in `scope`: its matches, itself as typed when none match, or as is when unread. */
function globbed(field: ShellWord, { dir }: Scope, p: typeof path): ShellWord[] {
  const tokens = globTokens(field);
  const matches = tokens === null || !dir.known ? null : globMatches(tokens, dir.path, p);

  if (tokens === null || matches === null) return [field];

  return matches.length === 0 ? [asTyped(field)] : matches.map((m) => quotedField(m, field.raw));
}

/** The words bash runs for `word`; null when its braces make more words than the gate reads. */
function wordsFor(word: ShellWord, scope: Scope, p: typeof path): ShellWord[] | null {
  return expandFields(word, scope.vars)?.flatMap((f) => globbed(f, scope, p)) ?? null;
}

/** The text of `word` when every part is literal, else "". */
function knownText(word: ShellWord | undefined): string {
  const parts = word?.parts ?? [];

  return parts.every((x): x is Extract<Part, { kind: "lit" }> => x.kind === "lit")
    ? parts.map((x) => x.bash).join("")
    : "";
}

/** The redirects of `c` with each file expanded; a target of several words gives one redirect each. */
function redirectsOf(redirects: readonly Redirect[], scope: Scope, p: typeof path): Redirect[] | null {
  const out: Redirect[] = [];

  for (const r of redirects) {
    const targets = DATA_REDIRECTS.has(r.op) ? [r.target] : wordsFor(r.target, scope, p);

    if (targets === null) return null;
    out.push(...targets.map((target) => ({ ...r, target })));
  }

  return out;
}

/**
 * The command bash runs for `c` in `scope`. The assignments before the program stay as typed, and so does an
 * assignment word after a program typed as `export` or `readonly`, since bash reads those as assignments; every other
 * word becomes its fields with each glob matched on disk from the dir. A data command read as values (a `case` word,
 * an arithmetic head) reads each word as one value. Null when braces make more words than the gate reads.
 */
export function expandCommand(c: Simple, scope: Scope, p: typeof path): Simple | null {
  if (c.data === "value") return { ...c, words: c.words.map((w) => expandValue(w, scope.vars)) };
  const at = programAt(c.words);
  const isSetter = SETTERS.has(programBase(knownText(c.words[at])));
  const words: ShellWord[] = c.words.slice(0, at);

  for (const [i, w] of c.words.entries()) {
    if (i < at) continue;
    const fields = isSetter && i > at && ASSIGNMENT_RE.test(w.raw) ? [w] : wordsFor(w, scope, p);

    if (fields === null) return null;
    words.push(...fields);
  }

  const redirects = redirectsOf(c.redirects, scope, p);

  return redirects === null ? null : { ...c, redirects, words };
}

function addKnown(acc: Acc, bash: string, kept: string): void {
  acc.text += bash;
  acc.pathText += kept;
  acc.pathBash += bash;
  acc.open += bash;
}

/** Adds an unknown part: `raw` as typed, and `pathText` as the path gate reads it. */
function addUnknown(acc: Acc, raw: string, pathText: string): void {
  acc.text += raw;
  acc.pathText += pathText;
  acc.pathBash += pathText;
  acc.done.push(acc.open);
  acc.open = "";
}

/** The tokens of a field that holds no pattern: its literal text, and its unknown parts. */
function plainTokens(parts: readonly Part[]): GlobToken[] {
  return parts.map((part) =>
    part.kind === "lit" ? { bash: part.bash, kind: "lit", text: part.text } : { kind: "part", part },
  );
}

/**
 * `field` as a gate judges it: literal text known, an expansion the walk could not read and a pattern character
 * unknown, a substitution as empty in the path spellings, and the pattern itself when bash would match one on disk.
 */
export function readWord(field: ShellWord): ReadWord {
  const tokens = globTokens(field);
  const acc: Acc = { done: [], open: "", pathBash: "", pathText: "", text: "" };

  for (const t of tokens ?? plainTokens(field.parts)) {
    if (t.kind === "lit") addKnown(acc, t.bash, t.text);
    else if (t.kind === "pat") addUnknown(acc, t.raw, t.raw);
    else addUnknown(acc, t.part.raw, t.part.kind === "param" ? t.part.raw : "");
  }

  const { done, open, pathBash, pathText, text } = acc;
  const glob = tokens === null ? null : globText(tokens);

  return { glob, literal: done.length === 0, pathBash, pathText, pieces: [...done, open], raw: field.raw, text };
}

/** A field's value: its text when every part is known, else unknown with the word as typed. */
export function valueOf(word: ReadWord): Value {
  return word.literal ? { known: true, text: word.text } : { cause: word.raw, known: false };
}
