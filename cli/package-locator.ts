/**
 * Which package a file a scan reads belongs to. Its package is its nearest package.json that has a `name`, or the
 * package's own; one without a `name`, such as a dual package's `{"type":"commonjs"}`, marks no package. A file is
 * the package's own only when that is the package's manifest; an installed file counts as the package its
 * `node_modules` path names, and any other file, such as a workspace sibling linked from under the package's dir, as
 * the package its manifest names.
 */
import path from "node:path";

import ts from "typescript";

import { isString } from "./json.ts";
import { posix } from "./ts-program.ts";
import { fieldsOf } from "./type-surface-blame.ts";
import { INSTALLED_SEGMENT, MANIFEST, PACKAGE_DIR } from "./type-surface.constants.ts";

/**
 * The package-relative name of an own file (null for any other), and the package any other file belongs to (null for
 * an own file or one under no named package.json).
 */
export type Locator = { ownName: (file: string) => string | null; packageOf: (file: string) => string | null };

/** The package's dir and virtual dir, with the nearest package.json of each dir and the name of each one, as read. */
type Lookups = {
  own: string;
  dir: string;
  virtual: string;
  manifests: Map<string, string | undefined>;
  names: Map<string | undefined, string | null>;
};

/** The package.json that marks the package of the dir `at`: the nearest one with a `name`, or the package's own. */
function markerOf(lookups: Lookups, at: string): string | undefined {
  const { own, manifests } = lookups;

  if (manifests.has(at)) return manifests.get(at);
  const file = path.join(at, MANIFEST);
  const isMarker = file === own || (ts.sys.fileExists(file) && nameOf(lookups, file) !== null);
  const above = path.dirname(at);
  let marker: string | undefined;

  if (isMarker) marker = file;
  else if (above !== at) marker = markerOf(lookups, above);
  manifests.set(at, marker);

  return marker;
}

/** The package.json that marks a file's package, a virtual file read at the real path it stands for. */
function manifestOf(lookups: Lookups, file: string): string | undefined {
  const { dir, virtual } = lookups;
  const real = file.startsWith(`${virtual}/`) ? path.join(dir, path.relative(virtual, file)) : file;

  return markerOf(lookups, path.dirname(real));
}

/** The `name` a package.json gives; null for none or a missing file. */
function nameOf({ names }: Lookups, manifest: string | undefined): string | null {
  const known = names.get(manifest);

  if (known !== undefined) return known;
  const { name } = fieldsOf(manifest);
  const found = isString(name) ? name : null;
  names.set(manifest, found);

  return found;
}

/** The locator for the package at `dir`, whose own declarations are held under `virtual`. */
export function packageLocator(native: string, virtual: string): Locator {
  const dir = posix(native);
  const own = path.join(dir, MANIFEST);
  const lookups: Lookups = { dir, manifests: new Map(), names: new Map(), own, virtual };

  return {
    ownName: (file) => {
      if (file.includes(INSTALLED_SEGMENT) || !file.startsWith(`${dir}/`)) return null;

      if (manifestOf(lookups, file) !== own) return null;

      return posix(path.relative(file.startsWith(`${virtual}/`) ? virtual : dir, file));
    },
    packageOf: (file) => {
      const installed = PACKAGE_DIR.exec(file)?.[1];

      if (installed !== undefined) return installed;
      const manifest = manifestOf(lookups, file);

      return manifest === own ? null : nameOf(lookups, manifest);
    },
  };
}
