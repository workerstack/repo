import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { parse, type ParseError } from "jsonc-parser";
import { z } from "zod";

import { isRecord, isString } from "./json.ts";
import { canonicalPath } from "./scripts/workspace-root.ts";
import { configOf, type TsConfig, type TsRun, withTsApi } from "./ts-api.ts";
import { posix } from "./ts-program.ts";
import { projectFile, referencedConfigs } from "./tsconfig-references.ts";
import { RESET, RUNTIME_CONFIG, SRC_CONFIG } from "./tsconfig.constants.ts";

const TSCONFIG_NAME = /^tsconfig(\..+)?\.json$/;
const PACKAGE_FILE = "package.json";

/** `-p x`, `--project x` and `--project=x` in a script; the value is the first capture. */
const PROJECT_FLAG = /(?:^|\s)(?:-p|--project)(?:=|\s+)(\S+)/g;
const REJECT_FILE = /\.reject\.tsx?$/;

/** The configs that type-check a package's code, which a reject file must stay out of. */
const CHECKING_CONFIGS: readonly string[] = [RUNTIME_CONFIG, SRC_CONFIG];

/** The strict flag a private package may turn off, as it publishes no declarations. */
const DECLARATIONS_FLAG = "isolatedDeclarations";

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

/** typescript keys its source files by forward-slash paths and asserts that spelling on win32. */
function tsPath(cwd: string, rel: string): string {
  return path.join(cwd, rel).split(path.sep).join("/");
}

/** What the reset check reads of a config: whether its own text sets `files`, and the root files it resolves to. */
type ResetRead = Readonly<{ hasOwnFiles: boolean; fileNames: readonly string[] }>;

function resetProblem(rel: string, { hasOwnFiles, fileNames }: ResetRead, reset: string): string | undefined {
  if (hasOwnFiles)
    return `tsconfig: ${rel} sets "files", which replaces the base's reset.d.ts. List sources under "include".`;

  const keepsReset = fileNames.some((name) => path.basename(name) === RESET && canonicalPath(name) === reset);

  if (keepsReset) return undefined;

  return `tsconfig: ${rel} does not extend a base. Extend "@workerstack/repo/tsconfig/base", "bun", "worker" or "web".`;
}

/** A `tsconfig.src.json` that resolves with any of `flags` off. */
function weakProblem(
  rel: string,
  options: TsConfig["options"],
  flags: readonly (typeof STRICT_FLAGS)[number][],
): string | undefined {
  const off = flags.filter((flag) => options[flag] !== true);

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
type Scan = { cwd: string; listed: ReadonlySet<string>; reset: string; ts: TsRun };

async function problems({ cwd, listed, reset, ts }: Scan, rel: string): Promise<string[]> {
  const raw = readRaw(cwd, rel);

  // A solution config checks no code, so TypeScript never needs to read it.
  if (Array.isArray(raw.files) && raw.files.length === 0 && raw.references !== undefined) return [];
  const read = await configOf(ts, tsPath(cwd, rel));

  if (!read.ok) return [`tsconfig: ${rel}: ${read.error}`];
  const name = path.posix.basename(rel);
  const dir = path.posix.dirname(rel);
  const hasOwnFiles = raw.files !== undefined;
  const lines = [resetProblem(rel, { fileNames: read.value.fileNames, hasOwnFiles }, reset)];

  // A private package publishes no declarations, so its inferred types need no annotation.
  if (name === SRC_CONFIG) {
    const isPrivate = readRaw(cwd, path.posix.join(dir, PACKAGE_FILE)).private === true;
    const flags = isPrivate ? STRICT_FLAGS.filter((flag) => flag !== DECLARATIONS_FLAG) : STRICT_FLAGS;
    lines.push(weakProblem(rel, read.value.options, flags));
  }

  if (name === RUNTIME_CONFIG && !listed.has(path.posix.join(dir, SRC_CONFIG))) lines.push(missingSrcConfig(dir));

  return [...lines.filter((line) => line !== undefined), ...rejectProblems(cwd, rel, read.value.fileNames)];
}

/** The fields a config or package.json is read for, each any JSON or absent; another top-level shape reads as `{}`. */
function rawConfigSchema() {
  return z
    .object({
      extends: z.json().optional(),
      files: z.json().optional(),
      private: z.json().optional(),
      references: z.json().optional(),
      scripts: z.json().optional(),
    })
    .catch({});
}

/** The raw JSON object at `cwd`/`rel`, empty when it is missing, unreadable or not valid JSON with comments. */
function readRaw(cwd: string, rel: string): z.output<ReturnType<typeof rawConfigSchema>> {
  let text: string;

  try {
    text = fs.readFileSync(path.join(cwd, rel), "utf8");
  } catch {
    return {};
  }

  const errors: ParseError[] = [];
  const config: unknown = parse(text, errors, { allowTrailingComma: true });

  return errors.length === 0 ? rawConfigSchema().parse(config) : {};
}

/** Every config the scripts of `dir`'s package.json run with `-p` or `--project`, relative to `cwd`. */
function scriptTargets(cwd: string, dir: string): string[] {
  const scripts = readRaw(cwd, path.posix.join(dir, PACKAGE_FILE)).scripts;
  const commands = isRecord(scripts) ? Object.values(scripts) : [];

  const flags = commands.filter(isString).flatMap((command) => [...command.matchAll(PROJECT_FLAG)]);

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

  const parents = [raw.extends].flat().flatMap((spec) => (isString(spec) && spec.startsWith(".") ? [spec] : []));

  const extended = parents.map((spec) => path.posix.join(dir, spec.endsWith(".json") ? spec : `${spec}.json`));

  const root = posix(cwd);
  const referenced = referencedConfigs(path.posix.join(root, rel)).map((ref) => path.posix.relative(root, ref));

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
export function checkTsconfigs(cwd: string, pkgRoot: string): Promise<string[]> {
  const reset = canonicalPath(path.join(pkgRoot, "tsconfig", RESET));
  const rels = listTsconfigs(cwd);
  const run = runConfigs(cwd, rels);

  return withTsApi(cwd, async (ts) => {
    const scan: Scan = { cwd, listed: new Set(rels), reset, ts };
    const lines: string[] = [];

    for (const rel of rels) lines.push(...(await problems(scan, rel)), ...unrunProblem(rel, run));

    return lines;
  });
}
