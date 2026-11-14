import { braceWords } from "./brace-words.ts";
/** The fields bash makes of a word from the variables a line sets, and what stays unknown until the shell runs. */
import type { Part, ShellWord, Value, Vars } from "./shell-ast.types.ts";

/** `$NAME`: a parameter form whose value is the variable's text. */
const BARE_PARAM_RE = /^\$([A-Za-z_]\w*)$/;

/** `${NAME}`: the other parameter form whose value is the variable's text. */
const BRACED_PARAM_RE = /^\$\{([A-Za-z_]\w*)\}$/;

/** A tilde prefix bash may expand: `~` and the text up to the first `/`, with no `$` or backtick in it. */
const TILDE_PREFIX_RE = /^~[^/$`]*/;

/** The variable each tilde prefix the gate can read stands for: `~` the home, `~+` the dir. */
const TILDE_VARS: ReadonlyMap<string, string> = /* @__PURE__ */ new Map([
  ["~", "HOME"],
  ["~+", "PWD"],
]);

/** The variable whose characters split an unquoted value into fields. */
const IFS = "IFS";

/** The characters of `IFS` that collapse and trim as one blank. */
const IFS_BLANKS = " \t\n";

/**
 * Fields being built: those done, the parts of the open one, whether it holds anything that keeps it, and the `IFS`
 * that splits an unquoted value (null when nothing splits).
 */
type Acc = { fields: Part[][]; open: Part[]; kept: boolean; ifs: Value | null };

/** A known parameter's value, and the part it came from. */
type Known = { part: Part; value: string };

/** The value of `name`, unknown with `$name` as cause when the line has not set it. */
export function lookup(vars: Vars, name: string): Value {
  return vars.get(name) ?? { cause: `$${name}`, known: false };
}

function lit(text: string, { quoted }: { quoted: boolean }): Part {
  return { bash: text, kind: "lit", quoted, text };
}

/** The known value of a parameter part, or null when it is another form or the line has not set it. */
function paramValue(part: Extract<Part, { kind: "param" }>, vars: Vars): string | null {
  const m = BARE_PARAM_RE.exec(part.raw) ?? BRACED_PARAM_RE.exec(part.raw);
  const value = m === null ? null : lookup(vars, String(m[1]));

  return value?.known === true ? value.text : null;
}

/** Closes the open field when it holds anything, or when a non-blank `IFS` character ends it. */
function cut(acc: Acc, { hard }: { hard: boolean }): void {
  if (acc.kept || hard) acc.fields.push(acc.open);
  acc.open = [];
  acc.kept = false;
}

function add(acc: Acc, part: Part): void {
  acc.open.push(part);
  acc.kept = true;
}

/** True when `ch` is an `IFS` character that collapses and trims as a blank. */
function isBlankIn(ifs: string, ch: string | undefined): boolean {
  return ch !== undefined && ifs.includes(ch) && IFS_BLANKS.includes(ch);
}

/** Splits an unquoted value into `acc` by `ifs`: blanks collapse and trim, any other `IFS` character ends a field. */
function splitInto(acc: Acc, value: string, ifs: string): void {
  for (let i = 0; i < value.length;) {
    let end = i;

    if (!ifs.includes(value.charAt(i))) {
      while (end < value.length && !ifs.includes(value.charAt(end))) end++;
      add(acc, lit(value.slice(i, end), { quoted: false }));
      i = end;
      continue;
    }

    while (isBlankIn(ifs, value[end])) end++;
    const hard = end < value.length && !isBlankIn(ifs, value[end]) && ifs.includes(value.charAt(end));

    if (hard) for (end++; isBlankIn(ifs, value[end]); end++);
    cut(acc, { hard });
    i = end;
  }
}

/** Folds an unquoted known value into `acc`, split by a known `IFS`; with an unknown one the part stays unknown. */
function addUnquoted(acc: Acc, { part, value }: Known, ifs: Value): void {
  if (!ifs.known) add(acc, part);
  else if (value !== "") splitInto(acc, value, ifs.text);
}

/** Folds one part into `acc`: a known parameter takes its value, split when unquoted and `acc` splits. */
function addPart(acc: Acc, part: Part, vars: Vars): void {
  const value = part.kind === "param" ? paramValue(part, vars) : null;

  if (part.kind === "lit" && part.quoted && part.bash === "") acc.kept = true;
  else if (value === null) add(acc, part);
  else if (part.kind === "param" && !part.quoted && acc.ifs !== null) addUnquoted(acc, { part, value }, acc.ifs);
  else add(acc, lit(value, { quoted: true }));
}

/** The part a tilde prefix stands for: the known home or dir, else the prefix as an unknown part. */
function tildeHead(prefix: string, vars: Vars): Part {
  const name = TILDE_VARS.get(prefix);
  const value = name === undefined ? null : lookup(vars, name);

  return value?.known === true
    ? lit(value.text, { quoted: true })
    : { kind: "param", quoted: true, raw: prefix, substs: [] };
}

/** The parts of `word` with a leading unquoted tilde prefix expanded: `~` the home, `~+` the dir, others unknown. */
function withTilde(word: ShellWord, vars: Vars): readonly Part[] {
  const [first, ...rest] = word.parts;

  if (first?.kind !== "lit" || first.quoted) return word.parts;
  const prefix = TILDE_PREFIX_RE.exec(first.bash)?.[0];

  if (prefix === undefined) return word.parts;
  const after = first.bash.slice(prefix.length);

  if (after === "" ? rest.length > 0 : !after.startsWith("/")) return word.parts;
  const left = after === "" ? [] : [{ ...first, bash: after, text: first.text.slice(prefix.length) }];

  return [tildeHead(prefix, vars), ...left, ...rest];
}

/** The parts of `word` after tilde and parameters, folded into a fresh `Acc` that splits by `ifs`. */
function folded(word: ShellWord, vars: Vars, ifs: Value | null): Acc {
  const acc: Acc = { fields: [], ifs, kept: false, open: [] };

  for (const part of withTilde(word, vars)) addPart(acc, part, vars);

  return acc;
}

/** The fields of one brace word: tilde, parameters, then splitting; an empty unquoted word drops. */
function fieldsOf(word: ShellWord, vars: Vars): ShellWord[] {
  const acc = folded(word, vars, lookup(vars, IFS));
  cut(acc, { hard: false });

  return acc.fields.map((parts) => ({ parts, raw: word.raw }));
}

/**
 * The fields bash makes of `word` with `vars`: braces, a leading `~` or `~+`, `$NAME` and `${NAME}` with a known
 * value, then splitting of each unquoted value by `IFS`. Every other expansion and substitution stays an unknown
 * part, and so does an unquoted value when `IFS` is unknown. Null when the braces make more words than the gate reads.
 */
export function expandFields(word: ShellWord, vars: Vars): ShellWord[] | null {
  return braceWords(word)?.flatMap((w) => fieldsOf(w, vars)) ?? null;
}

/** `word` read as one value, as bash reads an assignment, a `case` word or arithmetic: no braces and no splitting. */
export function expandValue(word: ShellWord, vars: Vars): ShellWord {
  return { parts: folded(word, vars, null).open, raw: word.raw };
}
