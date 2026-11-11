import path from "node:path";
import { tempDir, write } from "../../__fixtures__/planted-repo.ts";
import { spawnRunner } from "../../scripts/ci-wait-run.ts";
import { sideOf } from "../api-diff.ts";
import type { Side } from "../api-diff.ts";
import { INSTALLED_DIR } from "../consumer.constants.ts";
import { addedName, addSpecs, initProject, installedIn, installOld } from "../install.ts";
import { cleanManifest, fixtureTarball } from "./tarball.ts";

/** One version of the fixture package: its version, `exports` and files (path → text). */
export type Version = { version: string; exports: Record<string, unknown>; files: Record<string, string> };
/** A project with `@acme/fx` (new) and `old` (the other version) installed, and the two as sides. */
export type World = { project: string; old: Side; next: Side; roots: { old: string; next: string } };

export const PACKAGE_NAME = "@acme/fx";
const bun = spawnRunner("bun");

const tarballOf = (version: Version): string =>
  fixtureTarball(
    cleanManifest({ name: PACKAGE_NAME, version: version.version, exports: version.exports }),
    version.files,
  );

/** Packs both versions and installs them into one temp project with `install.ts`: the new as itself, the old as `old`. */
export function apiWorld(old: Version, next: Version): World {
  const project = tempDir();
  initProject(project);
  const added = addSpecs(project, [tarballOf(next)], { bun });
  if (added !== null) throw new Error(added);
  const nextPackage = installedIn(project, addedName(project));
  const failed = installOld(project, { tarball: tarballOf(old) }, { bun });
  if (failed !== null) throw new Error(failed);
  const oldPackage = installedIn(project, "old");
  return {
    project,
    old: sideOf(oldPackage),
    next: sideOf(nextPackage),
    roots: { old: oldPackage.root, next: nextPackage.root },
  };
}

/** A dependency to plant: its name, version and declarations. */
export type Dep = { name: string; version: string; types: string };

/** Plants a dependency in a root's own `node_modules`; the two roots need two versions, or TS treats the copies as one. */
export function plantDep(root: string, dep: Dep): void {
  write(path.join(root, INSTALLED_DIR, dep.name), {
    "package.json": { name: dep.name, version: dep.version, types: "index.d.ts" },
    "index.d.ts": dep.types,
  });
}
