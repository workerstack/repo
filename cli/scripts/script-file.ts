/**
 * The script files a command makes bash read, found the way bash finds them and read from disk, or from the text an
 * earlier command of the line wrote there: the one place the walk reads a script, so the parse and the walk stay pure.
 */
import fs from "node:fs";
import type path from "node:path";

import { commandAt } from "./command-at.ts";
import type { Dir, Redirect, Scope, Script, Simple } from "./shell-ast.types.ts";
import { readWord } from "./shell-fields.ts";
import { programName, redirectStdin } from "./shell-scripts.ts";
import { CAT, REPLACE_REDIRECTS, WRITE_REDIRECTS } from "./shell.constants.ts";

/** A script read or unreadable: what the walk takes. */
export type ReadScript = Exclude<Script, { kind: "file" }>;

/** The files earlier commands of the line wrote, by path: the text a `cat` heredoc put there, else null. */
export type Written = ReadonlyMap<string, string | null>;

/** A scope that also knows the `PATH` the shell started with and the files the line wrote so far. */
type FileScope = Scope & { path: string; written: Written };

/** The largest script file the gate reads; a bigger one is unread. */
const MAX_SCRIPT_BYTES = 256 * 1024;

/** A regular file at `file` no bigger than the cap, or one the line wrote. */
function isScriptFile(file: string, written: Written): boolean {
  if (written.has(file)) return true;
  const stat = fs.statSync(file, { throwIfNoEntry: false });

  return stat?.isFile() === true && stat.size <= MAX_SCRIPT_BYTES;
}

/**
 * The dirs `PATH` names, an empty entry the run dir once resolved from it: the line's own `PATH` when it set one, else
 * the one the shell started with; null when the line set one the gate cannot read.
 */
function pathDirs(scope: FileScope, p: typeof path): string[] | null {
  const value = scope.vars.get("PATH") ?? { known: true, text: scope.path };

  return value.known ? value.text.split(p.delimiter) : null;
}

/** A script file a command names, as the finder takes it. */
type FileScript = Extract<Script, { kind: "file" }>;

/**
 * The dirs bash looks for `name` in, from the run dir `here`: a name with a slash only there; else a shell tries
 * there then `PATH`, and `source` tries `PATH` then there. Null when `source` needs a `PATH` the gate does not know.
 */
function searchDirs(name: string, s: FileScript, scope: FileScope & { here: string; p: typeof path }): string[] | null {
  if (name.includes("/") || name.includes(scope.p.sep)) return [scope.here];
  const onPath = pathDirs(scope, scope.p);

  if (onPath === null) return s.inherits ? null : [scope.here];

  return s.inherits ? [...onPath, scope.here] : [scope.here, ...onPath];
}

/** Where bash finds `name`: an absolute name as is, else in the dirs it searches; null when the gate cannot tell. */
function findScript(name: string, s: FileScript, scope: FileScope & { p: typeof path }): string | null {
  const { dir, p, written } = scope;

  if (p.isAbsolute(name)) return isScriptFile(p.resolve(name), written) ? p.resolve(name) : null;

  if (!dir.known) return null;
  const dirs = searchDirs(name, s, { ...scope, here: dir.path });

  return dirs?.map((d) => p.resolve(dir.path, d, name)).find((f) => isScriptFile(f, written)) ?? null;
}

/** The text in `file`: what the line wrote there, else what is on disk; null when the gate cannot read it. */
function fileText(file: string, written: Written): string | null {
  if (written.has(file)) {
    const text = written.get(file) ?? null;

    return text === null || Buffer.byteLength(text) > MAX_SCRIPT_BYTES ? null : text;
  }

  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** The text of the script file `s` names in `scope`, or opaque by the word as typed when the gate cannot read it. */
function scriptFile(s: FileScript, scope: FileScope, p: typeof path): ReadScript {
  const read = readWord(s.word);
  const unread: ReadScript = { cause: read.raw, kind: "opaque" };
  const file = read.literal ? findScript(read.text, s, { ...scope, p }) : null;

  if (file === null) return unread;
  const text = fileText(file, scope.written);

  return text === null ? unread : { file, inherits: s.inherits, kind: "text", text };
}

/** `scripts` with each script file read in `scope`: its text, or opaque when the gate cannot read it. */
export function readScripts(scripts: readonly Script[], scope: FileScope, p: typeof path): ReadScript[] {
  return scripts.map((s) => (s.kind === "file" ? scriptFile(s, scope, p) : s));
}

/**
 * What `c` leaves in the file its write redirect `r`, at `i`, names: a `cat` with no operand prints the heredoc or
 * here-string it reads into the last file it replaces; any other write leaves text the gate cannot read. The lexer
 * drops a redirect's fd, so a `2>` reads as the file too, which leaves more files unknown, never fewer.
 */
function writtenText(c: Simple, r: Redirect, i: number): string | null {
  const at = commandAt(c.words);
  const last = c.redirects.findLastIndex((w) => WRITE_REDIRECTS.has(w.op));
  const stdin = redirectStdin(c.redirects, { kind: "none" });
  const isCat = programName(c.words[at]) === CAT && at === c.words.length - 1;
  const replaces = i === last && REPLACE_REDIRECTS.has(r.op);

  return isCat && replaces && stdin.kind === "text" ? stdin.text : null;
}

/** The path a write redirect names from `dir`; null when the gate cannot tell. */
function targetOf(r: Redirect, dir: Dir, p: typeof path): string | null {
  const t = readWord(r.target);

  if (!t.literal) return null;

  if (p.isAbsolute(t.text)) return p.resolve(t.text);

  return dir.known ? p.resolve(dir.path, t.text) : null;
}

/** The files the line wrote once `c` ran from `dir`, its write redirects added. */
export function writtenAfter(c: Simple, { dir, written }: { dir: Dir; written: Written }, p: typeof path): Written {
  const next = new Map(written);

  for (const [i, r] of c.redirects.entries()) {
    const file = WRITE_REDIRECTS.has(r.op) ? targetOf(r, dir, p) : null;

    if (file !== null) next.set(file, writtenText(c, r, i));
  }

  return next;
}

/** The files two branches wrote: the text both agree on, else unknown. */
export function joinWritten(a: Written, b: Written): Written {
  const files = new Set([...a.keys(), ...b.keys()]);

  return new Map(
    [...files].map((f) => {
      const text = a.get(f);

      return [f, text !== undefined && text === b.get(f) ? text : null];
    }),
  );
}
