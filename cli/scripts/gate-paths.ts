/** Which paths an agent may read or search, and how a typed path is judged. */
import fs from "node:fs";
import path from "node:path";

import { isString, type Json } from "../json.ts";
import type { ToolArgs } from "./gate-harness.ts";
import { BASH_DUMP_CMDS, NODE_MODULES, PATH_FIELDS } from "./gate.constants.ts";
import { patternWords } from "./pattern-words.ts";
import { type ShellCommand, shellWords } from "./shell-words.ts";
import { ASSIGNMENT_RE } from "./shell.constants.ts";
import { resolveTyped, type Roots } from "./workspace-root.ts";

export const DENY_PATH_SEGMENTS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  NODE_MODULES,
  "dist",
  ".next",
  "build",
  "coverage",
]);

const DENY_LOCKFILES: ReadonlySet<string> = /* @__PURE__ */ new Set(["bun.lock"]);

/**
 * A package's shipped `references/` dir under any `node_modules/@workerstack/<pkg>/`; the one `node_modules` path
 * agents may read.
 */
const STOCK_REFERENCES: RegExp = /(?:^|\/)node_modules\/@workerstack\/[^/]+\/references(?:\/|$)/;

/** A `.git` segment, at the start or after a blank or a slash. */
const GIT_DIR_RE = /(^|[\s/])\.git(\/|$)/;

/** The lockfile named as a word. */
const BUN_LOCK_RE = /\bbun\.lock\b/;

/** A Windows program's `.exe` ending, dropped before a command name is matched. */
const EXE_EXT_RE = /\.exe$/i;

/** True when `abs` is `base` or lies under it, by the `..`-prefix test the scratch rules use. */
export function isUnder(base: string, abs: string, p: typeof path = path): boolean {
  const rel = p.relative(base, abs);

  return !rel.startsWith("..") && !p.isAbsolute(rel);
}

/** `abs` relative to `base` in posix spelling, or null when it is `base` itself or outside it. */
export function relInside(base: string, abs: string, p: typeof path = path): string | null {
  const rel = p.relative(base, abs);

  if (rel === "" || rel.startsWith("..") || p.isAbsolute(rel)) return null;

  return rel.replaceAll("\\", "/");
}

/** The typed path with backslashes swapped and `.`/`..` folded, so `references/../cli` is judged as `cli`. */
function typedPosix(p: string): string {
  const swapped = p.replaceAll("\\", "/").trim();

  return swapped === "" ? "" : path.posix.normalize(swapped);
}

/** True when the typed path lies inside a stock references dir. */
export function inStockReferences(p: string): boolean {
  return STOCK_REFERENCES.test(typedPosix(p));
}

function gitDirIn(s: string): boolean {
  return GIT_DIR_RE.test(s.replaceAll("\\", "/"));
}

export function pathIsDenied(p: string | null | undefined): boolean {
  if (p == null) return false;
  const raw = p.replaceAll("\\", "/").trim();

  if (raw === "") return false;

  if (DENY_LOCKFILES.has(path.posix.basename(raw)) || gitDirIn(raw)) return true;
  // The match goes out as `/`, so what sat before and after it still reads as separate segments.
  const n = typedPosix(raw).replace(STOCK_REFERENCES, "/");

  if (DENY_LOCKFILES.has(path.posix.basename(n))) return true;

  return n.split("/").some((seg) => DENY_PATH_SEGMENTS.has(seg));
}

/**
 * True when a command bash would run, in a block, a substitution or a script a shell runs, dumps or searches a denied
 * path, a lockfile or `.git`. A line with no dump or search name is judged too when a value it sets spells one, when a
 * program is an expansion it cannot read, or when a shell runs a script it cannot read, since either may run any.
 */
export function bashTargetsDenylist(command: string | undefined): boolean {
  const cmd = command ?? "";
  const { commands, hasUnreadScript } = shellWords(cmd);

  if (!BASH_DUMP_CMDS.test(cmd) && !hasUnreadScript && !commands.some((c) => programExpanded(c) || dumps(c)))
    return false;

  return commands.some((c) => readsDeniedPath(c));
}

/** True when the program word of `c`, the first that sets no variable, holds an expansion. */
function programExpanded({ words, expanded }: ShellCommand): boolean {
  return expanded.has(words.findIndex((w) => !ASSIGNMENT_RE.test(w)));
}

/** True when a word of `c`, read with the values the line set, names a dump or search command (`${C}at`, `C=c`). */
function dumps({ words }: ShellCommand): boolean {
  return words.some((w) => isDumpName(w));
}

/** True when one spelling of a word names the lockfile, a `.git` dir, or (judged as a path) a denied path. */
function namesDenied(word: string, { asPath }: { asPath: boolean }): boolean {
  return BUN_LOCK_RE.test(word) || gitDirIn(word) || ((asPath || word.includes("/")) && pathIsDenied(word));
}

/**
 * True when the simple command `c` reads a denied path. Each word its program may open is judged, in both the spelling
 * `words` keeps and the one bash reads: in a command that runs a dump or search, as a path; in any other, when it holds
 * a slash; in every command, for the lockfile or a `.git` dir. A pattern its program never opens is skipped
 * (`patternWords`), and so is nothing a redirect names. A command that holds an expansion skips no pattern, since the
 * value may turn one into a path (`-e x`, `--files`), and one whose program is an expansion is judged as a dump.
 */
function readsDeniedPath(c: ShellCommand): boolean {
  const { words, bashWords, redirects, expanded } = c;
  const isDump = programExpanded(c) || dumps(c);
  const skipped = expanded.size > 0 ? new Set<number>() : skippedWords(words, redirects);

  return words.some(
    (w, i) =>
      !skipped.has(i) && (namesDenied(w, { asPath: isDump }) || namesDenied(String(bashWords[i]), { asPath: isDump })),
  );
}

/** The indices of `words` that are a pattern its program never opens; a redirect target is never one. */
function skippedWords(words: readonly string[], redirects: ReadonlySet<number>): Set<number> {
  const kept = words.flatMap((word, i) => (redirects.has(i) ? [] : [{ i, word }]));
  const pattern = patternWords(kept.map(({ word }) => word));

  return new Set(kept.flatMap(({ i }, at) => (pattern.has(at) ? [i] : [])));
}

/**
 * True when `word` names a dump or search command, bare or by path (`/usr/bin/cat`), read from the one pattern that
 * lists them.
 */
function isDumpName(word: string): boolean {
  const name = path.posix.basename(word.replaceAll("\\", "/")).replace(EXE_EXT_RE, "");

  return BASH_DUMP_CMDS.exec(name)?.[0] === name;
}

/** Every path-like string field of a search or read input. */
export function collectPathValues(input: ToolArgs): string[] {
  const values = PATH_FIELDS.map((key) => input[key]);

  return values.filter((v): v is string => typeof v === "string" && v !== "");
}

/** The file a Read names, in whichever spelling the harness uses. */
export function readFilePath(input: ToolArgs): Json {
  return [input.target_file, input.file_path, input.targetFile, input.filePath].find(Boolean) ?? "";
}

export function resolveReadPath(filePath: Json, roots: Roots): string | null {
  if (!isString(filePath) || filePath === "") return null;

  return resolveTyped(roots, filePath);
}

export function fileSizeBytes(absPath: string | null | undefined): number | null {
  if (absPath == null || absPath === "") return null;

  try {
    const st = fs.statSync(absPath);

    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}
