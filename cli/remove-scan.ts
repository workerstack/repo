import fs from "node:fs";
import path from "node:path";
import { atRoute } from "./at-route.ts";
import type { Removal } from "./removal.types.ts";
import type { Workspace } from "./sync/workspace.ts";
import { updateSources } from "./update-sources.ts";
import { CATALOG, ROOT_FILE } from "./update.constants.ts";
import { EXTRAS, PATCHED, VERSION_AT } from "./remove.constants.ts";

/** The name a key of `field` stands for; a patch key may be `name@version`, whose `@` after the first character starts the version. */
function nameOf(field: string, key: string): string {
  const at = key.lastIndexOf(VERSION_AT);
  return field === PATCHED && at > 0 ? key.slice(0, at) : key;
}

/** The root's overrides, resolutions, trusted dependencies and patches that name one of `names`. */
function extraRemovals(raw: unknown, names: readonly string[]): Removal[] {
  return EXTRAS.flatMap(({ field, homes }) =>
    homes.flatMap((parent) => {
      const node = atRoute(raw, parent);
      const keys = Array.isArray(node)
        ? node.map(String)
        : Object.keys(Object(node) /* an empty object when the home is absent */ as object);
      return keys
        .filter((key) => names.includes(nameOf(field, key)))
        .map((key) => ({
          name: nameOf(field, key),
          said: ROOT_FILE,
          field,
          file: ROOT_FILE,
          route: { parent, key },
          patch: field === PATCHED ? String(atRoute(raw, [...parent, key])) : null,
        }));
    }),
  );
}

/** The patch file's path under `root`, with the platform's separators. */
export function patchPath(root: string, patch: string): string {
  return path.join(root, ...patch.split("/"));
}

/**
 * Every entry that names one of `names`: manifest dependency fields (peers too) first, then catalogs, then the root's
 * overrides, resolutions, trusted dependencies and patches.
 */
export function removalsOf(root: string, workspace: Workspace, names: readonly string[]): Removal[] {
  const file = path.join(root, ROOT_FILE);
  const raw: unknown = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const sources = updateSources(workspace).filter((source) => names.includes(source.name));
  const entries = sources.flatMap((source) => source.paths.map((route) => ({ ...source, route, patch: null })));
  const fields = entries.filter((entry) => entry.field !== CATALOG);
  const catalogs = entries.filter((entry) => entry.field === CATALOG);
  const pick = ({ name, said, field, file: where, route, patch }: (typeof entries)[number]): Removal => ({
    name,
    said,
    field,
    file: where,
    route,
    patch,
  });
  return [...fields.map(pick), ...catalogs.map(pick), ...extraRemovals(raw, names)];
}
