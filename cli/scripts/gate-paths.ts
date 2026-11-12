/** Which paths an agent may read or search, and how a typed path is judged. */
import fs from "node:fs";
import path from "node:path";

import type { ToolArgs } from "./gate-harness.ts";
import { BASH_DUMP_CMDS, NODE_MODULES, PATH_FIELDS } from "./gate.constants.ts";
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

/** The blanks, quotes and shell operators that split a command into path-like tokens. */
const SHELL_TOKEN_SEP_RE = /[\s'"`|&;$(){}<>]+/;

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

/** True when a dump or search command names a denied path, a lockfile or `.git`. */
export function bashTargetsDenylist(command: string | undefined): boolean {
  const cmd = command ?? "";

  if (cmd.trim() === "" || !BASH_DUMP_CMDS.test(cmd)) return false;

  if (BUN_LOCK_RE.test(cmd) || gitDirIn(cmd)) return true;

  return cmd.split(SHELL_TOKEN_SEP_RE).some((token) => pathIsDenied(token));
}

/** Every path-like string field of a search or read input. */
export function collectPathValues(input: ToolArgs): string[] {
  const values = PATH_FIELDS.map((key) => input[key]);

  return values.filter((v): v is string => typeof v === "string" && v !== "");
}

/** The file a Read names, in whichever spelling the harness uses. */
export function readFilePath(input: ToolArgs): unknown {
  return [input.target_file, input.file_path, input.targetFile, input.filePath].find(Boolean) ?? "";
}

export function resolveReadPath(filePath: unknown, roots: Roots): string | null {
  if (typeof filePath !== "string" || filePath === "") return null;

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
