/**
 * Magic numbers and strings, as lint diagnostics `repo(magic-number)` and `repo(magic-string)` that the baseline
 * counts beside oxlint's. A script on the TypeScript compiler API, since only the type checker can tell a string
 * compared to a plain `string` from one compared to a literal union, and no disable comment reaches it. Each file is
 * checked in one program per nearest `tsconfig.json`, so a package's own paths and options resolve its imports.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { sourceFiles } from "./check-comments.ts";
import { findRoot, loadConfig, type LintSkip } from "./config.ts";
import { constString } from "./magic/magic-nodes.ts";
import { magicNumbers } from "./magic/magic-numbers.ts";
import type { MagicHit } from "./magic/magic-rules.ts";
import { magicStrings } from "./magic/magic-strings.ts";
import type { Diagnostic, Result } from "./scripts/lint-baseline.ts";
import { codeOf, skipFiles } from "./scripts/lint-skips.ts";

/** `repo check`'s magic hits: all of them for the skip report, those no skip turns off for the baseline. */
export type MagicCheck = { all: Diagnostic[]; kept: Diagnostic[]; problems: string[] };
/** A program's options, and the files its tsconfig.json includes. */
type Setup = { options: ts.CompilerOptions; fileNames: readonly string[] };

const SOURCE = /\.(?:tsx?|mts|cts)$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const TEST = /\.(?:test|spec|e2e)\./;
const SKIPPED_DIRS = ["fixtures", "e2e", "vendor", "node_modules"];
const TSCONFIG = "tsconfig.json";
const TOP = ".";
/** The options a file with no tsconfig.json above it is checked with: strict, resolved as a bundler would. */
const DEFAULTS: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  noEmit: true,
  skipLibCheck: true,
};
const NONE: MagicCheck = { all: [], kept: [], problems: [] };

const byKey = (a: string, b: string) => Number(a > b) - Number(a < b);
const posix = (file: string) => file.split(path.sep).join("/");

/** A root-relative source file the check reads: TypeScript, not a declaration, test, fixture, e2e or vendored file. */
function isChecked(rel: string): boolean {
  const dirs = path.posix.dirname(rel).split("/");
  const skipped = TEST.test(path.posix.basename(rel)) || dirs.some((dir) => SKIPPED_DIRS.includes(dir));
  return SOURCE.test(rel) && !DECLARATION.test(rel) && !skipped;
}

/** The root-relative dir of the tsconfig.json nearest above `rel`, up to the root; null when there is none. */
function ownerOf(root: string, rel: string): string | null {
  let dir = path.posix.dirname(rel);
  for (;;) {
    if (fs.existsSync(path.join(root, dir, TSCONFIG))) return dir;
    if (dir === TOP) return null;
    dir = path.posix.dirname(dir);
  }
}

function setupOf(root: string, dir: string | null): Result<Setup> {
  if (dir === null) return { ok: true, value: { options: DEFAULTS, fileNames: [] } };
  const file = posix(path.join(root, dir, TSCONFIG));
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error !== undefined) {
    const message = ts.flattenDiagnosticMessageText(read.error.messageText, " ");
    return { ok: false, errors: [`${path.posix.join(dir, TSCONFIG)}: ${message}`] };
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file), undefined, file);
  return { ok: true, value: { options: { ...parsed.options, noEmit: true }, fileNames: parsed.fileNames } };
}

/** The names of the `const` strings `file` declares, which a comparison in another file could make copies. */
function copyNames(file: ts.SourceFile): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && constString(node) !== null) names.push(node.name.getText());
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** One group's files: its tsconfig dir (null for none), the root and the files to report in, as program paths. */
type Group = { root: string; dir: string | null; targets: readonly string[] };

/**
 * The tsconfig's other checked files that mention a `const` string of the targets: a comparison there makes it a
 * copy, reported in the target. Read as text first, so a run on a few files parses only the files that could.
 */
function extrasOf(group: Group, setup: Setup, program: ts.Program): string[] {
  // The checker binds the files, which sets the parent links a declaration's const flag is read through.
  program.getTypeChecker();
  const names = program
    .getSourceFiles()
    .filter((file) => group.targets.includes(file.fileName))
    .flatMap(copyNames);
  if (names.length === 0) return [];
  return setup.fileNames.filter((fileName) => {
    const rel = path.posix.relative(group.root, fileName);
    if (group.targets.includes(fileName) || !isChecked(rel) || ownerOf(group.root, rel) !== group.dir) return false;
    const text = fs.readFileSync(fileName, "utf8");
    return names.some((name) => text.includes(name));
  });
}

/** Every hit in one group's targets, from one program over them and the files that may compare to their copies. */
function groupHits(group: Group): Result<MagicHit[]> {
  const setup = setupOf(group.root, group.dir);
  if (!setup.ok) return setup;
  const { options } = setup.value;
  const first = ts.createProgram({ rootNames: group.targets, options });
  const extras = extrasOf(group, setup.value, first);
  const roots = [...group.targets, ...extras];
  const program = extras.length === 0 ? first : ts.createProgram({ rootNames: roots, options, oldProgram: first });
  const owns = (fileName: string) => isChecked(path.posix.relative(group.root, fileName));
  const context = { checker: program.getTypeChecker(), owns };
  const walked = program.getSourceFiles().filter((file) => roots.includes(file.fileName));
  const hits = walked.flatMap((file) => {
    const numbers = group.targets.includes(file.fileName) ? magicNumbers(file, context.checker) : [];
    return [...numbers, ...magicStrings(file, context)];
  });
  return { ok: true, value: hits.filter((hit) => group.targets.includes(hit.fileName)) };
}

/** The hits as diagnostics, each once, in file then position order. */
function diagnosticsOf(root: string, hits: readonly MagicHit[]): Diagnostic[] {
  const unique = new Map(hits.map((hit) => [`${hit.fileName}:${hit.at}:${hit.rule}`, hit]));
  const sorted = [...unique.values()].sort((a, b) => byKey(a.fileName, b.fileName) || a.at - b.at);
  return sorted.map((hit) => {
    const file = path.posix.relative(root, hit.fileName);
    const rule = codeOf(hit.rule);
    return { file, rule, line: `${file}:${hit.line}:${hit.column}: error ${rule}: ${hit.message}` };
  });
}

/**
 * The magic hits in the checked files among `files` (root-relative POSIX paths), in oxlint's line form, sorted by file
 * and position; or why a tsconfig.json could not be read.
 */
export function magicDiagnostics(root: string, files: readonly string[]): Result<Diagnostic[]> {
  const real = posix(fs.realpathSync(root));
  const groups = new Map<string | null, string[]>();
  for (const rel of files.filter(isChecked)) {
    const dir = ownerOf(real, rel);
    groups.set(dir, [...(groups.get(dir) ?? []), path.posix.join(real, rel)]);
  }
  const hits: MagicHit[] = [];
  for (const [dir, targets] of groups) {
    const found = groupHits({ root: real, dir, targets });
    if (!found.ok) return found;
    hits.push(...found.value);
  }
  return { ok: true, value: diagnosticsOf(real, hits) };
}

/** `diagnostics` without those of a rule a skip turns off in a file of `files` its globs match. */
export function withoutSkipped(
  diagnostics: readonly Diagnostic[],
  skips: readonly LintSkip[],
  files: readonly string[],
): Diagnostic[] {
  const off = skips.flatMap((skip) => {
    const matched = skipFiles(skip.files, files);
    return skip.rules.flatMap((rule) => matched.map((file) => `${file} ${codeOf(rule)}`));
  });
  return diagnostics.filter((d) => !off.includes(`${d.file} ${d.rule}`));
}

/** `repo check`'s magic hits for the repo at `cwd`: none without a config or the standards pack. */
export async function checkMagicAt(cwd: string): Promise<MagicCheck> {
  const root = findRoot(cwd);
  if (root === null) return NONE;
  const loaded = await loadConfig(root);
  if (!loaded.ok || !loaded.config.packs.includes("standards")) return NONE;
  const listed = sourceFiles(root);
  if (!listed.ok) return { ...NONE, problems: listed.errors };
  const found = magicDiagnostics(root, listed.files);
  if (!found.ok) return { ...NONE, problems: found.errors };
  return { all: found.value, kept: withoutSkipped(found.value, loaded.config.lint.skip, listed.files), problems: [] };
}
