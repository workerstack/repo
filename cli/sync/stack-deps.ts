import path from "node:path";

import { DEPENDENCY_DIR } from "./available.constants.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { INDEX_REL } from "./maps.constants.ts";
import type { PackageJson, Workspace, WorkspacePackage } from "./workspace.ts";

const STACK_SCOPE = "@workerstack/";
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * The repo:deps lines of the INDEX of package `dir`: one link per dependency (any field) that is a workspace package,
 * then one per other `@workerstack/*` package, each group sorted by name. A workspace package wins over the installed
 * one, so a workspace `@workerstack/x` is linked in place.
 */
export function depsLines(dir: string, manifest: PackageJson, packages: readonly WorkspacePackage[]): string[] {
  const names = new Set(DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})));
  const inWorkspace = new Map(
    packages.flatMap((pkg) => (pkg.manifest.name === undefined ? [] : [[pkg.manifest.name, pkg.dir] as const])),
  );
  function link(name: string, target: string) {
    return `- [${name}](${path.posix.relative(`${dir}/references`, `${target}/${INDEX_REL}`)})`;
  }
  const workspace = [...inWorkspace].filter(([name]) => names.has(name)).toSorted(([a], [b]) => byCodeUnit(a, b));
  const stack = [...names]
    .filter((name) => !inWorkspace.has(name) && name.startsWith(STACK_SCOPE))
    .toSorted(byCodeUnit);
  return [
    ...workspace.map(([name, target]) => link(name, target)),
    ...stack.map((name) => link(name, `${DEPENDENCY_DIR}${name}`)),
  ];
}

/** Every `@workerstack/*` dependency name of the root and its packages, deduped and sorted. */
export function stackNames(workspace: Workspace): string[] {
  const names = new Set<string>();
  for (const manifest of [workspace.manifest, ...workspace.packages.map((pkg) => pkg.manifest)]) {
    for (const field of DEPENDENCY_FIELDS)
      for (const name of Object.keys(manifest[field] ?? {})) if (name.startsWith(STACK_SCOPE)) names.add(name);
  }
  return [...names].toSorted(byCodeUnit);
}
