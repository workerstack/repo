/**
 * The packages a package's exported types hand its consumers. Each typed `exports` target's source is compiled to
 * declarations in memory, under a virtual dir inside the package so bare imports resolve from it; a second program
 * over those declarations, the `.d.ts` targets without a source and the `.d.ts` files a json export lists names the
 * packages they use. An import of an own source by any specifier reads its declarations, never its bodies. Nothing is
 * written to disk.
 */
import path from "node:path";

import ts from "typescript";

import { packageLocator } from "./package-locator.ts";
import type { PackageJson } from "./sync/workspace.ts";
import { ownerOf, setupOf } from "./ts-program.ts";
import { RUNTIME_CONFIG } from "./tsconfig.constants.ts";
import { blame } from "./type-surface-blame.ts";
import { entriesOf, type MissingTypes } from "./type-surface-entries.ts";
import { keysOf, scanProgram } from "./type-surface-scan.ts";
import { VIRTUAL_DIR } from "./type-surface.constants.ts";

/**
 * Each package the exported types use, with the package-relative files that use it; each such file with the export
 * key whose types reach it; and the keys whose types file is absent.
 */
export type Surface = { uses: Map<string, string[]>; keys: Map<string, string>; missing: MissingTypes[] };

/** Where the package's own files sit: its dir, and the virtual dir their declarations are held under. */
type Place = { dir: string; virtual: string };

/** The package's own compiler options, set to emit declarations only, into the virtual dir. */
function emitOptions({ dir, virtual }: Place): ts.CompilerOptions {
  const setup = setupOf(dir, ownerOf(dir, RUNTIME_CONFIG), RUNTIME_CONFIG);

  return {
    ...(setup.ok ? setup.value.options : {}),
    composite: false,
    declaration: true,
    declarationDir: virtual,
    declarationMap: false,
    emitDeclarationOnly: true,
    incremental: false,
    noEmit: false,
    noEmitOnError: false,
    outDir: virtual,
    rootDir: dir,
    sourceMap: false,
  };
}

/** The virtual name of an own source file: its path under the virtual dir, its own extension kept. */
function virtualOf({ dir, virtual }: Place, file: string): string {
  return path.join(virtual, path.relative(dir, file));
}

/**
 * The declarations of `sources`, keyed by the virtual name of the source each is emitted from, so a `./x.ts` or
 * `./x.tsx` import in one resolves to another.
 */
function emitDeclarations(place: Place, sources: string[], options: ts.CompilerOptions): Map<string, string> {
  const emitted = new Map<string, string>();
  const program = ts.createProgram({ options, rootNames: sources });

  function write(...[, text, , , sourceFiles]: Parameters<ts.WriteFileCallback>): void {
    const [source] = sourceFiles /* a declaration-only emit writes one file per source */ as readonly [ts.SourceFile];

    emitted.set(virtualOf(place, source.fileName), text);
  }

  program.emit(undefined, write, undefined, true);

  return emitted;
}

/** The resolution of an import, sent to the emitted declarations when it reaches an own source file. */
function redirected(
  place: Place,
  emitted: Map<string, string>,
  found: ts.ResolvedModuleWithFailedLookupLocations,
): ts.ResolvedModuleWithFailedLookupLocations {
  const resolved = found.resolvedModule;

  if (resolved === undefined || !emitted.has(virtualOf(place, resolved.resolvedFileName))) return found;
  const resolvedFileName = virtualOf(place, resolved.resolvedFileName);

  return { ...found, resolvedModule: { ...resolved, isExternalLibraryImport: false, resolvedFileName } };
}

/** A host that reads the emitted declarations from memory, everything else from disk, and never an own source. */
function virtualHost(place: Place, options: ts.CompilerOptions, emitted: Map<string, string>): ts.CompilerHost {
  const host = ts.createCompilerHost(options);

  const memory: ts.CompilerHost = {
    ...host,
    directoryExists: (dir) => `${dir}/`.startsWith(`${place.virtual}/`) || ts.sys.directoryExists(dir),
    fileExists: (file) => emitted.has(file) || ts.sys.fileExists(file),
    getSourceFile: (file, language, ...rest) => {
      const text = emitted.get(file);

      if (text === undefined) return host.getSourceFile(file, language, ...rest);

      return ts.createSourceFile(file, text, language);
    },
    readFile: (file) => emitted.get(file) ?? ts.sys.readFile(file),
  };

  memory.resolveModuleNameLiterals = (...[literals, containing, reference, compilerOptions, containingFile]) =>
    literals.map((literal) => {
      const mode = ts.getModeForUsageLocation(containingFile, literal, compilerOptions);
      const found = ts.resolveModuleName(literal.text, containing, compilerOptions, memory, undefined, reference, mode);

      return redirected(place, emitted, found);
    });

  return memory;
}

/** The packages the types of `dir`'s `exports` use, and the keys whose types file is absent. */
export function typeSurface(dir: string, manifest: PackageJson): Surface {
  const { roots, missing } = entriesOf(dir, manifest);
  const place: Place = { dir, virtual: path.join(dir, VIRTUAL_DIR) };
  const options = emitOptions(place);
  const sources = roots.filter((root) => root.compile).map((root) => root.file);
  const emitted = emitDeclarations(place, sources, options);
  const host = virtualHost(place, options, emitted);
  const rootNames = roots.map(({ compile, file }) => (compile ? virtualOf(place, file) : file));
  const program = ts.createProgram({ host, options: { ...options, noEmit: true }, rootNames });
  const { used, links } = scanProgram(program, packageLocator(dir, place.virtual));

  const keys = keysOf(
    links,
    roots.map(({ file, key }) => [path.relative(dir, file), key] as const),
  );

  return { keys, missing, uses: blame(used, dir, manifest) };
}
