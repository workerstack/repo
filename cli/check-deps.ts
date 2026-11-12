import { ROOT_DIR, exposedDep, libraryDep, manifestFileOf, missingTypes } from "./check-deps.constants.ts";
import type { Workspace, WorkspacePackage } from "./sync/workspace.ts";
import type { Surface } from "./type-surface.ts";

/** The lines of one package: its missing types, then each `dependencies` entry its types use or, as a library, any. */
function packageLines({ dir, manifest }: WorkspacePackage, surface: Surface | undefined): string[] {
  if (manifest.private !== false || surface === undefined) return [];
  const file = manifestFileOf(dir);
  const isLibrary = manifest.bin === undefined;
  const lines = surface.missing.map((missing) => missingTypes(file, missing));

  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const used = surface.uses.get(name)?.[0];

    if (used !== undefined) lines.push(exposedDep(file, { file: used, key: surface.keys.get(used), name }));
    else if (isLibrary) lines.push(libraryDep(file, name));
  }

  return lines;
}

/**
 * `repo check`'s dependency lines for the root and each workspace package with `"private": false`, against the type
 * surfaces keyed by package dir (`.` for the root): a dep the exported types use belongs in `peerDependencies` and
 * `devDependencies`, and a library (no `bin`) keeps no `dependencies` at all.
 */
export function checkDeps({ manifest, packages }: Workspace, surfaces: ReadonlyMap<string, Surface>): string[] {
  return [{ dir: ROOT_DIR, manifest }, ...packages].flatMap((pkg) => packageLines(pkg, surfaces.get(pkg.dir)));
}
