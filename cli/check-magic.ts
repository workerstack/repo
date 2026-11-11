/**
 * Magic numbers, strings and regexes, as lint diagnostics `repo(magic-number)`, `repo(magic-string)` and
 * `repo(magic-regex)` that the baseline counts beside oxlint's. A script on the TypeScript compiler API, since only
 * the type checker can tell a string compared to a plain `string` from one compared to a literal union, and no
 * disable comment reaches it. Each file is checked in one program per nearest `tsconfig.json`, so a package's own
 * paths and options resolve its imports.
 */
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import { CONFIG_FILE } from "./config.constants.ts";
import { type LintSkip } from "./config.ts";
import { codeOf } from "./lint/script-rules.ts";
import type { MagicHit } from "./magic/magic-hit.ts";
import { constString } from "./magic/magic-nodes.ts";
import { magicNumbers } from "./magic/magic-numbers.ts";
import { magicRegexes } from "./magic/magic-regexes.ts";
import { magicStrings } from "./magic/magic-strings.ts";
import type { Diagnostic, Result } from "./scripts/lint-baseline.ts";
import { skipFiles } from "./scripts/lint-skips.ts";
import { isChecked, ownerOf, posix, setupOf, type Setup } from "./ts-program.ts";
import { RUNTIME_CONFIG } from "./tsconfig.constants.ts";

function byKey(a: string, b: string) {
  return Number(a > b) - Number(a < b);
}

/** The names of the `const` strings `file` declares, which a comparison in another file could make copies. */
function copyNames(file: ts.SourceFile): string[] {
  const names: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && constString(node) !== null) names.push(node.name.getText());
    ts.forEachChild(node, visit);
  }
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
  const setup = setupOf(group.root, group.dir, RUNTIME_CONFIG);
  if (!setup.ok) return setup;
  const { options } = setup.value;
  const first = ts.createProgram({ options, rootNames: group.targets });
  const extras = extrasOf(group, setup.value, first);
  const roots = [...group.targets, ...extras];
  const program = extras.length === 0 ? first : ts.createProgram({ oldProgram: first, options, rootNames: roots });
  function owns(fileName: string) {
    return isChecked(path.posix.relative(group.root, fileName));
  }
  const context = { checker: program.getTypeChecker(), owns };
  // The root config file holds values by definition, as a constants file does.
  const rootConfig = path.posix.join(group.root, CONFIG_FILE);
  const walked = program.getSourceFiles().filter((file) => roots.includes(file.fileName));
  const hits = walked.flatMap((file) => {
    const target = group.targets.includes(file.fileName) && file.fileName !== rootConfig;
    const own = target ? [...magicNumbers(file, context.checker), ...magicRegexes(file)] : [];
    return [...own, ...magicStrings(file, context)];
  });
  return { ok: true, value: hits.filter((hit) => group.targets.includes(hit.fileName)) };
}

/** File order, then position within a file. */
function byFileThenAt(a: MagicHit, b: MagicHit): number {
  const byFile = byKey(a.fileName, b.fileName);
  return byFile === 0 ? a.at - b.at : byFile;
}

/** The hits as diagnostics, each once, in file then position order. */
function diagnosticsOf(root: string, hits: readonly MagicHit[]): Diagnostic[] {
  const unique = new Map(hits.map((hit) => [`${hit.fileName}:${hit.at}:${hit.rule}`, hit]));
  const sorted = [...unique.values()].toSorted(byFileThenAt);
  return sorted.map((hit) => {
    const file = path.posix.relative(root, hit.fileName);
    const rule = codeOf(hit.rule);
    return { file, line: `${file}:${hit.line}:${hit.column}: error ${rule}: ${hit.message}`, rule };
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
    const found = groupHits({ dir, root: real, targets });
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
