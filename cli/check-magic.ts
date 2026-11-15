/**
 * Magic numbers, strings and regexes, as lint diagnostics `repo(magic-number)`, `repo(magic-string)` and
 * `repo(magic-regex)` that the baseline counts beside oxlint's. A script on the TypeScript compiler API, since only
 * the type checker can tell a string compared to a plain `string` from one compared to a literal union, and no
 * disable comment reaches it. Each file is checked on TypeScript 7 in a project per nearest `tsconfig.json`, so a
 * package's own paths and options resolve its imports.
 */
import fs from "node:fs";
import path from "node:path";

import type { Node, SourceFile } from "typescript/unstable/ast";
import { isVariableDeclaration } from "typescript/unstable/ast/is";
import type { Project } from "typescript/unstable/async";

import { CONFIG_FILE } from "./config.constants.ts";
import { type LintSkip } from "./config.ts";
import type { MagicHit } from "./magic/magic-hit.ts";
import { constString } from "./magic/magic-nodes.ts";
import { magicNumbers } from "./magic/magic-numbers.ts";
import { magicRegexes } from "./magic/magic-regexes.ts";
import { magicStrings } from "./magic/magic-strings.ts";
import type { Result } from "./result.ts";
import { codeOf } from "./script-rules.ts";
import type { Diagnostic } from "./scripts/lint-baseline.ts";
import { skipFiles } from "./scripts/lint-skips.ts";
import { type OwnerConfig, ownerConfig, sourcesOf, type TsRun, withFiles } from "./ts-api.ts";
import { byOwner, isChecked, ownerOf, posix } from "./ts-program.ts";

function byKey(a: string, b: string) {
  return Number(a > b) - Number(a < b);
}

/** The names of the `const` strings `file` declares, which a comparison in another file could make copies. */
function copyNames(file: SourceFile): string[] {
  const names: string[] = [];

  function visit(node: Node): void {
    if (isVariableDeclaration(node) && constString(node) !== null) names.push(node.name.getText());
    node.forEachChild(visit);
  }

  visit(file);

  return names;
}

/** One group's files: the root, its tsconfig dir (null for none) and the files to report in, as posix paths. */
type Group = { root: string; dir: string | null; targets: readonly string[] };

/**
 * The tsconfig's other checked files that mention a `const` string of the targets: a comparison there makes it a
 * copy, reported in the target. Read as text first, so a run on a few files parses only the files that could.
 */
function extrasOf(group: Group, config: OwnerConfig, targets: readonly SourceFile[]): string[] {
  const names = targets.flatMap(copyNames);

  if (names.length === 0) return [];

  return config.fileNames.filter((fileName) => {
    const rel = path.posix.relative(group.root, fileName);

    if (group.targets.includes(fileName) || !isChecked(rel) || ownerOf(group.root, rel) !== group.dir) return false;
    const text = fs.readFileSync(fileName, "utf8");

    return names.some((name) => text.includes(name));
  });
}

/** Every hit in the group's targets from `files`, the targets and the files that may compare to their copies. */
async function hitsIn(project: Project, group: Group, files: readonly SourceFile[]): Promise<MagicHit[]> {
  function owns(fileName: string) {
    return isChecked(path.posix.relative(group.root, fileName));
  }

  // The root config file holds values by definition, as a constants file does.
  const rootConfig = path.posix.join(group.root, CONFIG_FILE);
  const hits: MagicHit[] = [];

  for (const file of files) {
    const target = group.targets.includes(file.fileName) && file.fileName !== rootConfig;

    if (target) hits.push(...(await magicNumbers(file, project)), ...magicRegexes(file));
    hits.push(...(await magicStrings(file, { owns, project })));
  }

  return hits.filter((hit) => group.targets.includes(hit.fileName));
}

/**
 * Every hit in one group's targets, from a project over them; only when a target declares a `const` string that
 * other files mention, a wider one adds those files, reusing what the first parsed.
 */
async function groupHits(run: TsRun, group: Group): Promise<Result<MagicHit[]>> {
  const config = await ownerConfig(run, group.root, group.dir);

  if (!config.ok) return config;
  const spec = { base: config.value.base, dir: config.value.dir, files: group.targets };

  const hits = await withFiles(run, spec, async (project) => {
    const targets = await sourcesOf(project, group.targets);
    const extras = extrasOf(group, config.value, targets);

    if (extras.length === 0) return hitsIn(project, group, targets);
    const roots = [...group.targets, ...extras];

    return withFiles(run, { ...spec, files: roots }, async (wider) =>
      hitsIn(wider, group, await sourcesOf(wider, roots)),
    );
  });

  return { ok: true, value: hits };
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
 * and position; or why a tsconfig.json could not be read. Each owner's projects open on `run`, one at a time.
 */
export async function magicDiagnostics(
  run: TsRun,
  root: string,
  files: readonly string[],
): Promise<Result<Diagnostic[]>> {
  const real = posix(fs.realpathSync(root));
  const hits: MagicHit[] = [];

  for (const [dir, targets] of byOwner(real, files.filter(isChecked))) {
    const found = await groupHits(run, { dir, root: real, targets });

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
