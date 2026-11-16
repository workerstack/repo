/**
 * The packages a package's exported types hand its consumers. TS 7's tsc emits each typed `exports` target's source to
 * declarations in a temp dir inside the package's `.repo/tmp`, so bare imports resolve from the package; a project
 * over those declarations, the `.d.ts` targets without a source and the `.d.ts` files a json export lists names the
 * packages they use. An import of an own source by any specifier reads its declarations, never its bodies: a first
 * project over every emitted declaration finds the specifiers that reach an own source, and the scan's config maps
 * each to its declaration through `paths`. The temp dir is removed when the scan ends, whether it threw or not.
 */
import fs from "node:fs";
import path from "node:path";

import type { Node, SourceFile, StringLiteral } from "typescript/unstable/ast";
import { isStringLiteral } from "typescript/unstable/ast/is";
import type { CompilerOptions, Project, Symbol as TsSymbol } from "typescript/unstable/async";

import { declarationOf, sourcesOf } from "./build-outputs.ts";
import type { JsonInput } from "./json.ts";
import { packageLocator } from "./package-locator.ts";
import { removeEmptyDirs, removeTree } from "./remove-tree.ts";
import { repoPath, STATE } from "./repo-dirs.ts";
import { captureBun } from "./scripts/lint.ts";
import { tscBin } from "./scripts/package-bin.ts";
import type { PackageJson } from "./sync/workspace.ts";
import { NO_OWNER_OPTIONS, sourcesOf as parsedOf, withFiles, withTsApi } from "./ts-api.ts";
import type { TsRun } from "./ts-api.ts";
import { posix } from "./ts-program.ts";
import { RUNTIME_CONFIG } from "./tsconfig.constants.ts";
import { blame } from "./type-surface-blame.ts";
import { entriesOf, type MissingTypes } from "./type-surface-entries.ts";
import { isSpecifier, keysOf, scanProject } from "./type-surface-scan.ts";
import { EMIT_CONFIG, EMITTED_LINE, noDeclaration, SCAN_CONFIG, SURFACE_TEMP } from "./type-surface.constants.ts";

/**
 * Each package the exported types use, with the package-relative files that use it; each such file with the export
 * key whose types reach it; and the keys whose types file is absent.
 */
export type Surface = { uses: Map<string, string[]>; keys: Map<string, string>; missing: MissingTypes[] };

/** The `paths` of a project's options, with the dir their relative targets resolve from. */
type Paths = CompilerOptions & { pathsBasePath?: string };

/** Where the package's own files sit: its dir, the temp dir its declarations are emitted to, and its own tsconfig. */
type Place = { dir: string; virtual: string; base: string | null };

/** Compiler options as a tsconfig spells them. */
type Options = { readonly [key: string]: JsonInput | undefined };

/** A written tsconfig: the package's own one it extends, or none, with the options set over it. */
type Config = { extends?: string; compilerOptions: Options };

/** The package's own tsconfig, or the defaults when it has none, with `options` set on top. */
function ownConfig({ dir, base }: Place, options: Options): Config {
  if (base === null) return { compilerOptions: { ...NO_OWNER_OPTIONS, ...options } };

  return { compilerOptions: options, extends: path.posix.join(dir, base) };
}

/** The emit config: declarations only, of exactly `sources`, into the temp dir, rooted at the package. */
function emitConfig(place: Place, sources: readonly string[]): string {
  const emit = {
    composite: false,
    declaration: true,
    declarationDir: place.virtual,
    declarationMap: false,
    emitDeclarationOnly: true,
    incremental: false,
    noEmit: false,
    noEmitOnError: false,
    outDir: place.virtual,
    rootDir: place.dir,
    sourceMap: false,
  };

  return JSON.stringify({ ...ownConfig(place, emit), files: sources, include: [] });
}

/** A path relative to the package's dir, in typescript's slash spelling. */
function relTo({ dir }: Place, file: string): string {
  return posix(path.relative(dir, file));
}

/** The declaration tsc emits for an own source into the temp dir, where it mirrors the package. */
function emittedOf({ dir, virtual }: Place, source: string): string {
  return path.posix.join(virtual, path.posix.relative(dir, declarationOf(source)));
}

/** The source an emitted declaration comes from: the first that exists of those tsc names it after. */
function sourceOf({ dir, virtual }: Place, file: string): string | undefined {
  return sourcesOf(path.posix.join(dir, path.posix.relative(virtual, file))).find((each) => fs.existsSync(each));
}

/**
 * The declarations tsc emits for `sources`, each mapped to the source it is emitted from; an Error naming tsc's first
 * line when a source gets none, as when tsc cannot read it.
 */
async function emitDeclarations(place: Place, sources: readonly string[]): Promise<Map<string, string>> {
  const config = path.posix.join(place.virtual, EMIT_CONFIG);
  fs.writeFileSync(config, emitConfig(place, sources));
  const run = await captureBun([tscBin(), "-p", config, "--listEmittedFiles"], place.dir);
  const lines = run.stdout.split("\n");
  const files = lines.flatMap((line) => EMITTED_LINE.exec(line)?.slice(1) ?? []).map(posix);
  const pairs = files.map((file) => [file, sourceOf(place, file)] as const);
  const emitted = new Map(pairs.filter((pair): pair is readonly [string, string] => pair[1] !== undefined));
  const unemitted = sources.find((source) => !emitted.has(emittedOf(place, source)));

  if (unemitted !== undefined) throw new Error(noDeclaration(unemitted, lines.slice(0, 1).join("")));

  return emitted;
}

/** The module specifiers of a file: of each import, export and `import()` type. */
function specifiersOf(file: SourceFile): StringLiteral[] {
  const nodes: StringLiteral[] = [];

  function visit(node: Node): void {
    if (isStringLiteral(node) && isSpecifier(node)) nodes.push(node);
    node.forEachChild(visit);
  }

  file.forEachChild(visit);

  return nodes;
}

/** The file a specifier's module symbol is declared in; undefined when it reaches none. */
async function targetFile(project: Project, symbol: TsSymbol | undefined): Promise<string | undefined> {
  const handle = symbol?.declarations[0];
  const target = handle === undefined ? undefined : await handle.resolve(project);

  return target?.getSourceFile().fileName;
}

/** Each specifier in an emitted declaration that reaches an own source, with the declaration emitted from it. */
async function redirects(project: Project, emitted: ReadonlyMap<string, string>): Promise<Map<string, string>> {
  const declarations = new Map([...emitted].map(([declaration, source]) => [source, declaration]));
  const found = new Map<string, string>();

  for (const file of await parsedOf(project, [...emitted.keys()])) {
    const nodes = specifiersOf(file);
    const symbols = await project.checker.getSymbolAtLocation(nodes);

    for (const [index, node] of nodes.entries()) {
      const declaration = declarations.get((await targetFile(project, symbols[index])) ?? "");

      if (declaration !== undefined) found.set(node.text, declaration);
    }
  }

  return found;
}

/** `targets` resolved from `base`, as a written tsconfig needs them when it sits in another dir. */
function absoluteOf(base: string, targets: readonly string[]): string[] {
  return targets.map((target) => path.posix.resolve(base, target));
}

/** The scan's config: the package's own, its `paths` kept with absolute targets and each redirect added exactly. */
function scanConfig(place: Place, project: Project, found: ReadonlyMap<string, string>): string {
  // tsgo sends pathsBasePath, the dir `paths` resolve from, though its type omits it.
  const options = project.compilerOptions /* the field is sent at runtime */ as Paths;
  const { paths = {}, pathsBasePath = place.dir } = options;
  const mapped = new Map<string, string[]>();

  for (const [key, targets] of Object.entries(paths)) mapped.set(key, absoluteOf(pathsBasePath, targets));

  for (const [specifier, declaration] of found) mapped.set(specifier, [declaration]);

  return JSON.stringify(ownConfig(place, { paths: Object.fromEntries(mapped) }));
}

/** The surface of the package in `place`, read inside an open API. */
async function readSurface(run: TsRun, place: Place, manifest: PackageJson): Promise<Surface> {
  const { dir, virtual, base } = place;
  const { roots, missing } = await entriesOf(run, dir, manifest);
  const compiled = roots.filter((root) => root.compile).map((root) => root.file);
  const emitted = await emitDeclarations(place, compiled);
  const all = { base, dir, files: [...emitted.keys()].map((file) => relTo(place, file)) };

  const config = await withFiles(run, all, async (project) =>
    scanConfig(place, project, await redirects(project, emitted)),
  );

  const scanFile = path.posix.join(virtual, SCAN_CONFIG);
  fs.writeFileSync(scanFile, config);
  const files = roots.map(({ compile, file }) => relTo(place, compile ? emittedOf(place, file) : file));
  const locator = packageLocator(dir, virtual, emitted);
  const scan = { base: relTo(place, scanFile), dir, files };
  const { used, links } = await withFiles(run, scan, (project) => scanProject(project, locator));
  const named = roots.map(({ file, key }) => [relTo(place, file), key] as const);
  const keys = keysOf(links, named);

  return { keys, missing, uses: blame(used, dir, manifest) };
}

/** The packages the types of `dir`'s `exports` use, and the keys whose types file is absent. */
export async function typeSurface(native: string, manifest: PackageJson): Promise<Surface> {
  const dir = posix(fs.realpathSync(native));
  const temp = repoPath(dir, STATE);
  const made = fs.mkdirSync(temp, { recursive: true });
  const virtual = posix(fs.mkdtempSync(path.join(temp, SURFACE_TEMP)));
  const base = fs.existsSync(path.join(dir, RUNTIME_CONFIG)) ? RUNTIME_CONFIG : null;

  try {
    return await withTsApi(dir, (run) => readSurface(run, { base, dir, virtual }, manifest));
  } finally {
    removeTree(virtual);
    removeEmptyDirs(temp, made);
  }
}
