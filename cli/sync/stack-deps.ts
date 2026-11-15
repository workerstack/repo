import path from "node:path";

import { DEPENDENCY_DIR } from "./available.constants.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { INDEX_REL } from "./maps.constants.ts";
import type { Workspace, WorkspacePackage } from "./workspace.ts";

type Read = (rel: string) => string | null;

const STACK_SCOPE = "@workerstack/";
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * The repo:deps lines of the INDEX of package `pkg`: one link per dependency (any field) that is a workspace package,
 * then one per other `@workerstack/*` package that ships an installed references index, each group sorted by name. A
 * workspace package wins over the installed one, so a workspace `@workerstack/x` is linked in place.
 */
export function depsLines(
  { dir, manifest }: WorkspacePackage,
  packages: readonly WorkspacePackage[],
  read: Read,
): string[] {
  const names = new Set(DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})));

  const inWorkspace = new Map(
    packages.flatMap((pkg) => (pkg.manifest.name === undefined ? [] : [[pkg.manifest.name, pkg.dir] as const])),
  );

  function link(name: string, target: string) {
    return `- [${name}](${path.posix.relative(`${dir}/references`, `${target}/${INDEX_REL}`)})`;
  }

  const workspace = [...inWorkspace].filter(([name]) => names.has(name)).toSorted(([a], [b]) => byCodeUnit(a, b));

  const stack = [...names]
    .filter((name) => !inWorkspace.has(name) && name.startsWith(STACK_SCOPE) && hasIndex(read, name))
    .toSorted(byCodeUnit);

  return [
    ...workspace.map(([name, target]) => link(name, target)),
    ...stack.map((name) => link(name, `${DEPENDENCY_DIR}${name}`)),
  ];
}

/** Whether the installed stack package `name` ships a references index. */
function hasIndex(read: Read, name: string): boolean {
  return read(`${DEPENDENCY_DIR}${name}/${INDEX_REL}`) !== null;
}

/** The `@workerstack/*` dependency names of `stackNames` whose installed package ships a references index. */
export function linkedStackNames(workspace: Workspace, read: Read): string[] {
  return stackNames(workspace).filter((name) => hasIndex(read, name));
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
