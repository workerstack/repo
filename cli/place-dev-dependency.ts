// Where init puts the `@workerstack/repo` dependency: in devDependencies, moved there from dependencies.
import type { PackageJson } from "./package-json.ts";
import { PACKAGE_NAME } from "./sync/package-name.constants.ts";

/** Moves `@workerstack/repo` out of `deps` into `devDeps`, keeping a version `devDeps` already has. */
function moveFromDependencies(destPkg: PackageJson, devDeps: Map<string, string>): void {
  const deps = destPkg.dependencies;
  const fromDep = deps?.[PACKAGE_NAME];

  if (deps === undefined || fromDep == null) return;
  delete deps[PACKAGE_NAME];

  if (!devDeps.has(PACKAGE_NAME)) devDeps.set(PACKAGE_NAME, fromDep);

  if (Object.keys(deps).length === 0) delete destPkg.dependencies;
}

/**
 * Puts `@workerstack/repo` into `destPkg`'s devDependencies: moved from its dependencies, else the version of
 * `srcPkg` when that is the running repo package. Returns the devDependencies it set on `destPkg`.
 */
export function placeDevDependency(destPkg: PackageJson, srcPkg?: PackageJson): Record<string, string> {
  const devDeps = new Map(Object.entries(destPkg.devDependencies ?? {}));
  moveFromDependencies(destPkg, devDeps);
  const version = srcPkg?.name === PACKAGE_NAME ? srcPkg.version : undefined;

  if (!devDeps.has(PACKAGE_NAME) && version !== undefined && version !== "") devDeps.set(PACKAGE_NAME, version);
  const placed = Object.fromEntries(devDeps);
  destPkg.devDependencies = placed;

  return placed;
}
