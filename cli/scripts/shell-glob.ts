/** Filename expansion patterns: which words hold a pattern bash matches on disk, and the pattern as text and RegExp. */
import type { Part, ShellWord } from "./shell-ast.types.ts";
import { LAST } from "./shell.constants.ts";

/** The characters a backslash escapes in a pattern so they match only themselves. */
const SPECIAL_RE = /[\\*?[]/g;

/** A character a RegExp reads as syntax. */
const REGEXP_SPECIAL_RE = /[.*+?^${}()|[\]\\/]/g;

/** A character a RegExp class reads as syntax; `-` stays a range. */
const CLASS_SPECIAL_RE = /[\\\]^[]/g;

/** The POSIX classes a bracket may name, as RegExp class text. */
const CLASSES: ReadonlyMap<string, string> = /* @__PURE__ */ new Map([
  ["alnum", "A-Za-z0-9"],
  ["alpha", "A-Za-z"],
  ["blank", " \\t"],
  ["cntrl", "\\x00-\\x1f\\x7f"],
  ["digit", "0-9"],
  ["graph", "!-~"],
  ["lower", "a-z"],
  ["print", " -~"],
  ["punct", "!-/:-@\\[-`{-~"],
  ["space", " \\t\\n\\r\\f\\v"],
  ["upper", "A-Z"],
  ["word", "\\w"],
  ["xdigit", "0-9A-Fa-f"],
]);

/** A `[:name:]` class at the start of the text. */
const CLASS_RE = /^\[:(\w+):\]/;

/** A part whose text the walk does not know: an expansion or a substitution. */
type UnknownPart = Exclude<Part, { kind: "lit" }>;

/** A unit of a pattern: a character bash may read as pattern syntax, text that matches itself, or an unknown part. */
type Atom =
  | { kind: "ch"; ch: string }
  | { kind: "lit"; text: string; bash: string }
  | { kind: "part"; part: UnknownPart };

/** A pattern read into text that matches itself, pattern syntax (`raw` as typed, `re` as RegExp text), and parts. */
export type GlobToken =
  | { kind: "lit"; text: string; bash: string }
  | { kind: "pat"; raw: string; re: string }
  | { kind: "part"; part: UnknownPart };

/** A token a disk search can match: text or pattern syntax, no unknown part. */
export type MatchToken = Exclude<GlobToken, { kind: "part" }>;

type LitToken = Extract<GlobToken, { kind: "lit" }>;

export function isMatchToken(t: GlobToken): t is MatchToken {
  return t.kind !== "part";
}

export function isLitToken(t: MatchToken): t is LitToken {
  return t.kind === "lit";
}

function fieldAtoms(field: ShellWord): Atom[] {
  return field.parts.flatMap((part): Atom[] => {
    if (part.kind !== "lit") return [{ kind: "part", part }];

    return part.quoted
      ? [{ bash: part.bash, kind: "lit", text: part.text }]
      : part.bash.split("").map((ch) => ({ ch, kind: "ch" }));
  });
}

/** The atoms of a pattern written with `\` before each character that matches only itself. */
function patternAtoms(glob: string): Atom[] {
  const atoms: Atom[] = [];

  for (let i = 0; i < glob.length; i++) {
    const ch = glob.charAt(i);

    if (ch === "\\" && i + 1 < glob.length) {
      const next = glob.charAt(++i);
      atoms.push({ bash: next, kind: "lit", text: next });
    } else {
      atoms.push({ ch, kind: "ch" });
    }
  }

  return atoms;
}

/** The RegExp class text of a bracket body; null when it names a class bash knows and the gate does not. */
function classText(body: string): string | null {
  let out = "";

  for (let i = 0; i < body.length; i++) {
    const cls = CLASS_RE.exec(body.slice(i));

    if (cls === null) {
      out += body.charAt(i).replaceAll(CLASS_SPECIAL_RE, "\\$&");
    } else {
      const text = CLASSES.get(String(cls[1]));

      if (text === undefined) return null;
      out += text;
      i += cls[0].length - 1;
    }
  }

  return out;
}

/**
 * The bracket that opens at `at` in `text` (all pattern characters): its length and RegExp text; null when it never
 * closes.
 */
function bracketAt(text: string, at: number): { length: number; re: string } | null {
  let i = at + 1;
  const negated = text[i] === "!" || text[i] === "^";

  if (negated) i++;
  const start = i;

  if (text[i] === "]") i++;

  for (; i < text.length && text[i] !== "]"; i++) {
    const cls = CLASS_RE.exec(text.slice(i));

    if (cls !== null) i += cls[0].length - 1;
  }

  if (i >= text.length) return null;
  const body = classText(text.slice(start, i));
  const re = body === null ? "[^/]" : `[${negated ? "^/" : ""}${body}]`;

  return { length: i + 1 - at, re };
}

/** The characters of the run of pattern atoms from `at`, up to a slash or another kind of atom. */
function runFrom(atoms: readonly Atom[], at: number): string {
  let run = "";

  for (let i = at; i < atoms.length; i++) {
    const a = atoms[i];

    if (a?.kind !== "ch" || a.ch === "/") break;
    run += a.ch;
  }

  return run;
}

/** The pattern token a character opens at `i`, or null when it matches only itself. */
function patternAt(atoms: readonly Atom[], i: number): { token: GlobToken; length: number } | null {
  const a = atoms[i];

  if (a?.kind !== "ch") return null;

  if (a.ch === "*") return { length: 1, token: { kind: "pat", raw: "*", re: "[^/]*" } };

  if (a.ch === "?") return { length: 1, token: { kind: "pat", raw: "?", re: "[^/]" } };
  const run = a.ch === "[" ? runFrom(atoms, i) : "";
  const bracket = run === "" ? null : bracketAt(run, 0);

  return bracket === null
    ? null
    : { length: bracket.length, token: { kind: "pat", raw: run.slice(0, bracket.length), re: bracket.re } };
}

function tokensOf(atoms: readonly Atom[]): GlobToken[] {
  const tokens: GlobToken[] = [];

  let next = 0;

  for (const [i, a] of atoms.entries()) {
    if (i < next) continue;
    const pat = patternAt(atoms, i);
    const last = tokens.at(LAST);
    next = i + (pat?.length ?? 1);

    if (pat !== null) {
      tokens.push(pat.token);
    } else if (a.kind === "part") {
      tokens.push(a);
    } else {
      const [text, bash] = a.kind === "ch" ? [a.ch, a.ch] : [a.text, a.bash];

      if (last?.kind === "lit")
        tokens[tokens.length - 1] = { bash: last.bash + bash, kind: "lit", text: last.text + text };
      else tokens.push({ bash, kind: "lit", text });
    }
  }

  return tokens;
}

/** The tokens of `field` when it holds a pattern bash would match on disk, else null. */
export function globTokens(field: ShellWord): GlobToken[] | null {
  const tokens = tokensOf(fieldAtoms(field));

  return tokens.some((t) => t.kind === "pat") ? tokens : null;
}

/** `tokens` as one pattern, each character that matches only itself escaped, an unknown part as typed. */
export function globText(tokens: readonly GlobToken[]): string {
  return tokens
    .map((t) => (t.kind === "pat" ? t.raw : (t.kind === "lit" ? t.bash : t.part.raw).replaceAll(SPECIAL_RE, "\\$&")))
    .join("");
}

/** The RegExp of one path segment's tokens; a leading `.` must be typed, as bash matches a name. */
export function regExpOf(tokens: readonly MatchToken[]): RegExp {
  const [first] = tokens;
  const dot = first?.kind === "lit" && first.bash.startsWith(".") ? "" : "(?!\\.)";
  const body = tokens.map((t) => (t.kind === "pat" ? t.re : t.bash.replaceAll(REGEXP_SPECIAL_RE, "\\$&")));

  return new RegExp(`^${dot}${body.join("")}$`);
}

/** The RegExp one segment of a pattern written as `globText` makes, or null when it matches only itself. */
export function segmentRegExp(segment: string): RegExp | null {
  const tokens = tokensOf(patternAtoms(segment)).filter(isMatchToken);

  return tokens.some((t) => t.kind === "pat") ? regExpOf(tokens) : null;
}
