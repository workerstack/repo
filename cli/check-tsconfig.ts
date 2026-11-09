import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { canonicalPath } from "./scripts/workspace-root.ts";
import { RESET, RUNTIME_CONFIG, SRC_CONFIG } from "./tsconfig.constants.ts";

const TSCONFIG_NAME = /^tsconfig(\..+)?\.json$/;
/** The flags `tsconfig/strict.json` turns on, which a `tsconfig.src.json` must resolve with. */
const STRICT_FLAGS = [
  "isolatedDeclarations",
  "erasableSyntaxOnly",
  "verbatimModuleSyntax",
  "exactOptionalPropertyTypes",
  "noUncheckedIndexedAccess",
] as const;

/** Tracked and untracked, non-ignored tsconfigs under `cwd`, posix and relative to it; none outside a git repo. */
function listTsconfigs(cwd: string): string[] {
  let out: string;
  try {
    out = execFileSync("git", ["ls-files", "-z", "-co", "--exclude-standard"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  // An unmerged path is listed once per stage, and a deleted tracked one stays in the index.
  const rels = new Set(out.split("\0").filter((rel) => TSCONFIG_NAME.test(path.posix.basename(rel))));
  return [...rels].filter((rel) => fs.existsSync(path.join(cwd, rel)));
}

/** The line check prints, and turn repeats, for a folder whose `tsconfig.json` has no strict sibling; `.` is the root. */
export function missingSrcConfig(dir: string): string {
  return `tsconfig: ${dir} has no ${SRC_CONFIG}; add one with "extends": ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"] and an "exclude" that repeats tsconfig.json's and adds the tests`;
}

/** A tsconfig parsed, with what its own text sets, or the line naming why it cannot be read. */
type Read =
  | { ok: true; setsFiles: boolean; solution: boolean; parsed: ts.ParsedCommandLine }
  | { ok: false; line: string };

function readTsconfig(cwd: string, rel: string): Read {
  // typescript keys its source files by forward-slash paths and asserts that spelling on win32.
  const file = path.join(cwd, rel).split(path.sep).join("/");
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error) {
    return { ok: false, line: `tsconfig: ${rel}: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}` };
  }
  // Without a read error, typescript has parsed the root as a JSON object.
  const raw: { files?: unknown; references?: unknown } = read.config;
  // Read before parsing, which writes the inherited "files" into the raw object.
  const setsFiles = raw.files !== undefined;
  const solution = Array.isArray(raw.files) && raw.files.length === 0 && raw.references !== undefined;
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file), undefined, file);
  return { ok: true, setsFiles, solution, parsed };
}

function resetProblem(rel: string, read: Read & { ok: true }, reset: string): string | undefined {
  if (read.setsFiles) {
    return `tsconfig: ${rel} sets "files", which replaces the base's reset.d.ts. List sources under "include".`;
  }
  const names = read.parsed.fileNames;
  const keepsReset = names.some((name) => path.basename(name) === RESET && canonicalPath(name) === reset);
  if (keepsReset) return undefined;
  return `tsconfig: ${rel} does not extend a base. Extend "@workerstack/repo/tsconfig/base", "bun", "worker" or "web".`;
}

/** A `tsconfig.src.json` that resolves with any strict flag off. */
function weakProblem(rel: string, options: ts.CompilerOptions): string | undefined {
  const off = STRICT_FLAGS.filter((flag) => options[flag] !== true);
  if (off.length === 0) return undefined;
  return `tsconfig: ${rel} resolves without ${off.join(", ")}; extend "@workerstack/repo/tsconfig/strict" and drop the override`;
}

/** What a check of the tsconfigs under `cwd` reads: every listed one, and the canonical path of the base reset.d.ts. */
type Scan = { cwd: string; listed: ReadonlySet<string>; reset: string };

function problems({ cwd, listed, reset }: Scan, rel: string): string[] {
  const read = readTsconfig(cwd, rel);
  if (!read.ok) return [read.line];
  if (read.solution) return [];
  const name = path.posix.basename(rel);
  const dir = path.posix.dirname(rel);
  const lines = [resetProblem(rel, read, reset)];
  if (name === SRC_CONFIG) lines.push(weakProblem(rel, read.parsed.options));
  if (name === RUNTIME_CONFIG && !listed.has(path.posix.join(dir, SRC_CONFIG))) lines.push(missingSrcConfig(dir));
  return lines.filter((line) => line !== undefined);
}

/**
 * One stderr line per tsconfig under `cwd` that drops ts-reset (it sets `files`, extends no base from `pkgRoot`, or
 * cannot be read), per `tsconfig.json` with no `tsconfig.src.json` beside it, and per `tsconfig.src.json` that
 * resolves with a strict flag off. A solution-style `{"files": [], "references": [...]}` checks no code and passes.
 */
export function checkTsconfigs(cwd: string, pkgRoot: string): string[] {
  const reset = canonicalPath(path.join(pkgRoot, "tsconfig", RESET));
  const rels = listTsconfigs(cwd);
  const scan: Scan = { cwd, listed: new Set(rels), reset };
  return rels.flatMap((rel) => problems(scan, rel));
}
