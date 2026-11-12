import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import { canonicalPath } from "./scripts/workspace-root.ts";
import { RESET, RUNTIME_CONFIG, SRC_CONFIG } from "./tsconfig.constants.ts";

const TSCONFIG_NAME = /^tsconfig(\..+)?\.json$/;
const PACKAGE_FILE = "package.json";

/** `-p x`, `--project x` and `--project=x` in a script; the value is the first capture. */
const PROJECT_FLAG = /(?:^|\s)(?:-p|--project)(?:=|\s+)(\S+)/g;
const QUOTES = /^["']|["']$/g;
const REJECT_FILE = /\.reject\.tsx?$/;

/** The configs that type-check a package's code, which a reject file must stay out of. */
const CHECKING_CONFIGS: readonly string[] = [RUNTIME_CONFIG, SRC_CONFIG];

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

/**
 * The line check prints, and turn repeats, for a folder whose `tsconfig.json` has no strict sibling; `.` is the
 * root.
 */
export function missingSrcConfig(dir: string): string {
  return (
    `tsconfig: ${dir} has no ${SRC_CONFIG}; add one with ` +
    `"extends": ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"] ` +
    `and an "exclude" that repeats tsconfig.json's and adds the tests`
  );
}

/** A tsconfig parsed, with what its own text sets, or the line naming why it cannot be read. */
type Read =
  | {
      ok: true;
      hasFiles: boolean;
      solution: boolean;
      parsed: ts.ParsedCommandLine;
    }
  | { ok: false; line: string };

/** The text of `file`, or undefined when it cannot be read. */
function readText(file: string): string | undefined {
  return ts.sys.readFile(file);
}

/** typescript keys its source files by forward-slash paths and asserts that spelling on win32. */
function tsPath(cwd: string, rel: string): string {
  return path.join(cwd, rel).split(path.sep).join("/");
}

function readTsconfig(cwd: string, rel: string): Read {
  const file = tsPath(cwd, rel);
  const read = ts.readConfigFile(file, readText);

  if (read.error !== undefined) {
    return {
      line: `tsconfig: ${rel}: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`,
      ok: false,
    };
  }

  const config: unknown = read.config;

  const raw = config /* without a read error, typescript has parsed the root as a JSON object */ as {
    files?: unknown;
    references?: unknown;
  };

  // Read before parsing, which writes the inherited "files" into the raw object.
  const hasFiles = raw.files !== undefined;
  const solution = Array.isArray(raw.files) && raw.files.length === 0 && raw.references !== undefined;
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file), undefined, file);

  return { hasFiles, ok: true, parsed, solution };
}

function resetProblem(rel: string, read: Read & { ok: true }, reset: string): string | undefined {
  if (read.hasFiles)
    return `tsconfig: ${rel} sets "files", which replaces the base's reset.d.ts. List sources under "include".`;

  const names = read.parsed.fileNames;
  const keepsReset = names.some((name) => path.basename(name) === RESET && canonicalPath(name) === reset);

  if (keepsReset) return undefined;

  return `tsconfig: ${rel} does not extend a base. Extend "@workerstack/repo/tsconfig/base", "bun", "worker" or "web".`;
}

/** A `tsconfig.src.json` that resolves with any strict flag off. */
function weakProblem(rel: string, options: ts.CompilerOptions): string | undefined {
  const off = STRICT_FLAGS.filter((flag) => options[flag] !== true);

  if (off.length === 0) return undefined;

  return (
    `tsconfig: ${rel} resolves without ${off.join(", ")}; ` +
    `extend "@workerstack/repo/tsconfig/strict" and drop the override`
  );
}

/** One line per reject file a checking config includes, which would fail its type check on purpose. */
function rejectProblems(cwd: string, rel: string, fileNames: readonly string[]): string[] {
  if (!CHECKING_CONFIGS.includes(path.posix.basename(rel))) return [];
  const included = fileNames.filter((name) => REJECT_FILE.test(name));

  return included.map((name) => {
    const file = path.relative(cwd, name).split(path.sep).join("/");

    return `tsconfig: ${rel} includes ${file}; add "**/*.reject.ts" and "**/*.reject.tsx" to its exclude`;
  });
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

  return [...lines.filter((line) => line !== undefined), ...rejectProblems(cwd, rel, read.parsed.fileNames)];
}

function isObject(value: unknown): value is { path?: unknown } {
  return value instanceof Object;
}

/** The keys of a package.json or tsconfig this check reads; typescript parses a JSON file's root as an object. */
type RawConfig = { scripts?: unknown; extends?: unknown; references?: unknown };

function isRawConfig(value: unknown): value is RawConfig {
  return value instanceof Object;
}

/** The raw JSON object at `cwd`/`rel`, empty when it is missing or unreadable. */
function readRaw(cwd: string, rel: string): RawConfig {
  const read = ts.readConfigFile(tsPath(cwd, rel), readText);

  return read.error === undefined && isRawConfig(read.config) ? read.config : {};
}

/** The config a `-p` value or a reference `path` names from `dir`: the file, or a folder's `tsconfig.json`. */
function projectFile(dir: string, spec: string): string {
  const target = path.posix.join(dir, spec.replaceAll(QUOTES, ""));

  return target.endsWith(".json") ? target : path.posix.join(target, RUNTIME_CONFIG);
}

/** Every config the scripts of `dir`'s package.json run with `-p` or `--project`, relative to `cwd`. */
function scriptTargets(cwd: string, dir: string): string[] {
  const scripts = readRaw(cwd, path.posix.join(dir, PACKAGE_FILE)).scripts;
  const commands = typeof scripts === "object" && scripts !== null ? Object.values(scripts) : [];

  const flags = commands
    .filter((command) => typeof command === "string")
    .flatMap((command) => [...command.matchAll(PROJECT_FLAG)]);

  return flags.flatMap((flag) => flag.slice(1).map((spec) => projectFile(dir, spec)));
}

/** The folders from `rel`'s own up to `cwd` that hold a package.json. */
function packageDirs(cwd: string, rel: string): string[] {
  const dirs: string[] = [];

  for (let dir = path.posix.dirname(rel); ; dir = path.posix.dirname(dir)) {
    if (fs.existsSync(path.join(cwd, dir, PACKAGE_FILE))) dirs.push(dir);

    if (dir === ".") return dirs;
  }
}

/** The local configs `rel` extends and references; an extends of a package is outside the repo's own files. */
function linkedConfigs(cwd: string, rel: string): string[] {
  const raw = readRaw(cwd, rel);
  const dir = path.posix.dirname(rel);

  const parents = [raw.extends]
    .flat()
    .flatMap((spec) => (typeof spec === "string" && spec.startsWith(".") ? [spec] : []));

  const refs = Array.isArray(raw.references) ? raw.references : [];
  const extended = parents.map((spec) => path.posix.join(dir, spec.endsWith(".json") ? spec : `${spec}.json`));

  const referenced = refs.flatMap((ref) =>
    isObject(ref) && typeof ref.path === "string" ? [projectFile(dir, ref.path)] : [],
  );

  return [...extended, ...referenced];
}

/** The configs a gate runs: the two by name, those a script names, and all they extend or reference. */
function runConfigs(cwd: string, rels: readonly string[]): Set<string> {
  const named = rels.filter((rel) => CHECKING_CONFIGS.includes(path.posix.basename(rel)));
  const scripted = [...new Set(rels.flatMap((rel) => packageDirs(cwd, rel)))].flatMap((dir) => scriptTargets(cwd, dir));
  const queue = [...named, ...scripted];
  const seen = new Set<string>();

  for (const rel of queue) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    queue.push(...linkedConfigs(cwd, rel));
  }

  return seen;
}

function unrunProblem(rel: string, run: ReadonlySet<string>): string[] {
  if (run.has(rel)) return [];

  return [`tsconfig: ${rel} is run by no gate; delete it, or run it from a package.json script with tsc -p ${rel}`];
}

/**
 * One stderr line per tsconfig under `cwd` that drops ts-reset (it sets `files`, extends no base from `pkgRoot`, or
 * cannot be read), per `tsconfig.json` with no `tsconfig.src.json` beside it, and per `tsconfig.src.json` that
 * resolves with a strict flag off, and per reject file a `tsconfig.json` or `tsconfig.src.json` includes. A
 * solution-style `{"files": [], "references": [...]}` checks no code and passes. A tsconfig no gate runs gets a line
 * too: run means named `tsconfig.json` or `tsconfig.src.json`, named by `-p` or `--project` in a script of a
 * package.json above it, or extended or referenced, transitively, by a run config.
 */
export function checkTsconfigs(cwd: string, pkgRoot: string): string[] {
  const reset = canonicalPath(path.join(pkgRoot, "tsconfig", RESET));
  const rels = listTsconfigs(cwd);
  const scan: Scan = { cwd, listed: new Set(rels), reset };
  const run = runConfigs(cwd, rels);

  return rels.flatMap((rel) => [...problems(scan, rel), ...unrunProblem(rel, run)]);
}
