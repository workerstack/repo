import { atRoute } from "./at-route.ts";
import { FIELDS } from "./dependency-names.ts";
import type { PackageJson, Workspace } from "./sync/workspace.ts";
import { catalogsOf } from "./sync/workspace.ts";
import { CATALOG, CATALOGS, ROOT_FILE, WORKSPACES, catalogSaid, catalogWhere } from "./update.constants.ts";
import type { Source } from "./update.types.ts";

/** The places bun reads a catalog from: the manifest's top level and under `workspaces`. */
function homes(scope: string | null): string[][] {
  return scope === null
    ? [[CATALOG], [WORKSPACES, CATALOG]]
    : [
        [CATALOGS, scope],
        [WORKSPACES, CATALOGS, scope],
      ];
}

/** One source per entry of a catalog, with every path in the root manifest that holds the entry. */
function catalogSources(manifest: PackageJson, scope: string | null, entries: Record<string, string>): Source[] {
  return Object.entries(entries).map(([name, spec]) => ({
    field: CATALOG,
    file: ROOT_FILE,
    name,
    paths: homes(scope)
      .map((parent) => ({ key: name, parent }))
      .filter((route) => atRoute(manifest, [...route.parent, route.key]) !== undefined),
    said: catalogSaid(scope),
    spec,
    where: catalogWhere(scope),
  }));
}

/** One source per dependency a manifest declares in any of the four fields. */
function fieldSources(manifest: PackageJson, dir: string): Source[] {
  const file = dir === "" ? ROOT_FILE : `${dir}/${ROOT_FILE}`;
  const where = dir === "" ? ROOT_FILE : dir;
  return FIELDS.flatMap((field) =>
    Object.entries(manifest[field] ?? {}).map(([name, spec]) => ({
      field,
      file,
      name,
      paths: [{ key: name, parent: [field] }],
      said: where,
      spec,
      where,
    })),
  );
}

/** Every place a name lives, in the order the table lists them: the catalogs, the root's fields, then each package. */
export function updateSources(workspace: Workspace): Source[] {
  const { manifest, packages } = workspace;
  const catalogs = catalogsOf(manifest);
  return [
    ...catalogSources(manifest, null, catalogs.default),
    ...Object.entries(catalogs.named).flatMap(([scope, entries]) => catalogSources(manifest, scope, entries)),
    ...fieldSources(manifest, ""),
    ...packages.flatMap((pkg) => fieldSources(pkg.manifest, pkg.dir)),
  ];
}
