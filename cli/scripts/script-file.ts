/**
 * The script files a command makes bash read, found the way bash finds them and read from disk: the one place the
 * walk reads a script, so the parse and the walk stay pure.
 */
import fs from "node:fs";
import type path from "node:path";

import type { Scope, Script } from "./shell-ast.types.ts";
import { readWord } from "./shell-fields.ts";

/** A script read or unreadable: what the walk takes. */
export type ReadScript = Exclude<Script, { kind: "file" }>;

/** The largest script file the gate reads; a bigger one is unread. */
const MAX_SCRIPT_BYTES = 256 * 1024;

/** A regular file at `file` no bigger than the cap, else null. */
function isScriptFile(file: string): boolean {
  const stat = fs.statSync(file, { throwIfNoEntry: false });

  return stat?.isFile() === true && stat.size <= MAX_SCRIPT_BYTES;
}

/** The dirs `PATH` names, an empty entry the run dir once resolved from it; null when `PATH` is unknown. */
function pathDirs(scope: Scope, p: typeof path): string[] | null {
  const value = scope.vars.get("PATH");

  return value === undefined || !value.known ? null : value.text.split(p.delimiter);
}

/** A script file a command names, as the finder takes it. */
type FileScript = Extract<Script, { kind: "file" }>;

/**
 * The dirs bash looks for `name` in, from the run dir `here`: a name with a slash only there; else a shell tries
 * there then `PATH`, and `source` tries `PATH` then there. Null when `source` needs a `PATH` the gate does not know.
 */
function searchDirs(name: string, s: FileScript, scope: Scope & { here: string; p: typeof path }): string[] | null {
  if (name.includes("/") || name.includes(scope.p.sep)) return [scope.here];
  const onPath = pathDirs(scope, scope.p);

  if (onPath === null) return s.inherits ? null : [scope.here];

  return s.inherits ? [...onPath, scope.here] : [scope.here, ...onPath];
}

/** Where bash finds `name`: an absolute name as is, else in the dirs it searches; null when the gate cannot tell. */
function findScript(name: string, s: FileScript, scope: Scope & { p: typeof path }): string | null {
  const { dir, p } = scope;

  if (p.isAbsolute(name)) return isScriptFile(name) ? name : null;

  if (!dir.known) return null;
  const dirs = searchDirs(name, s, { ...scope, here: dir.path });

  return dirs?.map((d) => p.resolve(dir.path, d, name)).find(isScriptFile) ?? null;
}

/** The text of the script file `s` names in `scope`, or opaque by the word as typed when the gate cannot read it. */
function scriptFile(s: FileScript, scope: Scope, p: typeof path): ReadScript {
  const read = readWord(s.word);
  const unread: ReadScript = { cause: read.raw, kind: "opaque" };
  const file = read.literal ? findScript(read.text, s, { ...scope, p }) : null;

  if (file === null) return unread;

  try {
    return { file, inherits: s.inherits, kind: "text", text: fs.readFileSync(file, "utf8") };
  } catch {
    return unread;
  }
}

/** `scripts` with each script file read in `scope`: its text, or opaque when the gate cannot read it. */
export function readScripts(scripts: readonly Script[], scope: Scope, p: typeof path): ReadScript[] {
  return scripts.map((s) => (s.kind === "file" ? scriptFile(s, scope, p) : s));
}
