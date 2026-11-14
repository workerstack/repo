/** A word's value as bash expands it from the variables a line sets, and what stays unknown until the shell runs. */
import type { Part, ReadWord, ShellWord, Value, Vars } from "./shell-ast.types.ts";

/** `$NAME`: a parameter form whose value is the variable's text. */
const BARE_PARAM_RE = /^\$([A-Za-z_]\w*)$/;

/** `${NAME}`: the other parameter form whose value is the variable's text. */
const BRACED_PARAM_RE = /^\$\{([A-Za-z_]\w*)\}$/;

/**
 * A tilde prefix bash expands: `~` and the text up to the first `/`. One that holds a quote, a backslash or a `$` is
 * left as typed, so it matches none.
 */
const TILDE_PREFIX_RE = /^~[^/"'\\$`]*(?=\/|$)/;

/** The variable each tilde prefix the gate can read stands for: `~` the home, `~+` the dir. */
const TILDE_VARS: ReadonlyMap<string, string> = /* @__PURE__ */ new Map([
  ["~", "HOME"],
  ["~+", "PWD"],
]);

/** The characters bash expands as a pattern in an unquoted value. */
const GLOB_RE = /[*?[]/;

/** The variable whose characters split an unquoted value into words. */
const IFS = "IFS";

/** How a word is read: with these variables, and split by `IFS` unless it is an assignment value. */
type Reading = { vars: Vars; split: boolean };

/**
 * A word being built: its bash text, the path gate's two spellings, the known text before each unknown part
 * (`done`), and the known text since the last one (`open`).
 */
type Acc = { text: string; pathText: string; pathBash: string; done: string[]; open: string };

/** A word's value: its text when every part is known, else unknown with the text as typed. */
export function valueOf(word: ReadWord): Value {
  return word.literal ? { known: true, text: word.text } : { cause: word.raw, known: false };
}

/** The value of `name`, unknown with `$name` as cause when the line has not set it. */
export function lookup(vars: Vars, name: string): Value {
  return vars.get(name) ?? { cause: `$${name}`, known: false };
}

/** Adds known text: `bash` as bash reads it, `kept` with a Windows path's backslashes. */
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

/** True when bash would split or glob `text` as an unquoted value: an empty value, a pattern, or an `IFS` char. */
function splits(text: string, vars: Vars): boolean {
  const ifs = lookup(vars, IFS);

  return !ifs.known || text === "" || GLOB_RE.test(text) || ifs.text.split("").some((ch) => text.includes(ch));
}

/** The text a parameter gives as one word, or null when its value is unknown or splits into other words. */
function paramValue(part: Extract<Part, { kind: "param" }>, { vars, split }: Reading): string | null {
  const m = BARE_PARAM_RE.exec(part.raw) ?? BRACED_PARAM_RE.exec(part.raw);

  if (m === null) return null;
  const value = lookup(vars, String(m[1]));

  if (!value.known) return null;

  return split && !part.quoted && splits(value.text, vars) ? null : value.text;
}

/** Folds one part into `acc`; a substitution and any parameter form but a plain name stay unknown. */
function addPart(acc: Acc, part: Part, reading: Reading): void {
  if (part.kind === "lit") {
    addKnown(acc, part.bash, part.text);

    return;
  }

  const value = part.kind === "param" ? paramValue(part, reading) : null;

  if (value === null) addUnknown(acc, part.raw, part.kind === "param" ? part.raw : "");
  else addKnown(acc, value, value);
}

/** Expands a leading unquoted tilde prefix into `acc`; returns the parts left to read. */
function withTilde(word: ShellWord, vars: Vars, acc: Acc): readonly Part[] {
  const [first, ...rest] = word.parts;
  const prefix = TILDE_PREFIX_RE.exec(word.raw)?.[0];

  if (prefix === undefined || first?.kind !== "lit" || !first.bash.startsWith(prefix)) return word.parts;
  const value = lookup(vars, TILDE_VARS.get(prefix) ?? "");

  if (value.known && TILDE_VARS.has(prefix)) addKnown(acc, value.text, value.text);
  else addUnknown(acc, prefix, prefix);
  const left = { ...first, bash: first.bash.slice(prefix.length), text: first.text.slice(prefix.length) };

  return [left, ...rest];
}

/**
 * `word` as bash expands it with `vars`: `$NAME` and `${NAME}` take a known value, a leading `~` or `~+` the home or
 * the dir. An unquoted value that `IFS` would split, or that holds a pattern, stays unknown, and so does every other
 * expansion and substitution. `split: false` reads the word as an assignment value, which bash never splits.
 */
export function expandWord(word: ShellWord, vars: Vars, { split = true }: { split?: boolean } = {}): ReadWord {
  const acc: Acc = { done: [], open: "", pathBash: "", pathText: "", text: "" };

  for (const part of withTilde(word, vars, acc)) addPart(acc, part, { split, vars });
  const { done, open, pathBash, pathText, text } = acc;

  return { literal: done.length === 0, pathBash, pathText, pieces: [...done, open], raw: word.raw, text };
}
