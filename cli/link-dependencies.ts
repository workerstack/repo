/**
 * A linked copy holds only the packed files, so a dependency the checkout added since the npm version is not in the
 * consumer's install. This links each such dependency into the copy's nested install dir from the checkout's own
 * install, so the copy resolves what the checkout runs with.
 */
import fs from "node:fs";
import path from "node:path";

import { installedDir, readName, readVersion, type Manifest } from "./link-installed.ts";
import type { LinkTarget } from "./link-io.types.ts";
import { CHECKOUT_TOP, DIR_LINK, MODULES, NPM_PREFIX, SCOPE_PREFIX } from "./link.constants.ts";
import { removeTree } from "./remove-tree.ts";

/** npm:, file:, git and URL specifiers are not semver ranges, so they are not judged. */
export function isSemverRange(range: string): boolean {
  return !range.includes(":") && !range.includes("/");
}

/** The package and range of an `npm:<name>@<range>` alias spec, or null for any other spec. */
function parseAlias(spec: string): { name: string; range: string } | null {
  if (!spec.startsWith(NPM_PREFIX)) return null;
  const rest = spec.slice(NPM_PREFIX.length);
  const at = rest.lastIndexOf("@");
  const range = rest.slice(at + 1);

  return at > 0 && isSemverRange(range) ? { name: rest.slice(0, at), range } : null;
}

type Wanted = { dep: string; name: string | null; range: string };

/** What linking wants for one dependency: nothing for a spec that is neither a semver range nor an alias. */
function wantedOf(dep: string, spec: string): Wanted[] {
  const alias = parseAlias(spec);

  if (alias !== null) return [{ dep, name: alias.name, range: alias.range }];

  return isSemverRange(spec) ? [{ dep, name: null, range: spec }] : [];
}

/** The version of `dep` the copy at `copy` resolves: its nested install first, then `root`'s; null when neither. */
export function resolvedVersion(copy: string, root: string, dep: string): string | null {
  return readVersion(path.join(copy, MODULES, dep)) ?? readVersion(installedDir(root, dep));
}

function inRange(version: string | null, range: string): boolean {
  return version !== null && Bun.semver.satisfies(version, range);
}

/** `dir` and the dirs above it up to the nearest one holding `.git`; only `dir` when none does. */
function checkoutDirs(dir: string): string[] {
  const up = [dir];

  for (let at = dir; !fs.existsSync(path.join(at, CHECKOUT_TOP));) {
    const parent = path.dirname(at);

    if (parent === at) return [dir];
    up.push(parent);
    at = parent;
  }

  return up;
}

/** The names of the dir links in an install dir, scoped ones as `@scope/name`. */
function linkedNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [entry.name];

    if (!entry.isDirectory() || !entry.name.startsWith(SCOPE_PREFIX)) return [];

    return linkedNames(path.join(dir, entry.name)).map((name) => `${entry.name}/${name}`);
  });
}

/**
 * Links into the copy of `target` in `root`'s install each dependency the copy does not resolve in range, from the
 * first install dir the checkout resolves it from when that copy is in range. Before that it removes the links a
 * former link made for names the manifest no longer lists, so a relink converges on the same tree. A dependency
 * neither install holds in range is left for the warning.
 */
export function linkDependencies(root: string, target: LinkTarget, manifest: Manifest): void {
  const copy = installedDir(root, target.name);
  const nested = path.join(copy, MODULES);
  const wanted = Object.entries(manifest.dependencies ?? {}).flatMap(([dep, spec]) => wantedOf(dep, spec));
  const names = new Set(wanted.map((entry) => entry.dep));

  for (const name of linkedNames(nested)) if (!names.has(name)) removeTree(path.join(nested, name));

  const dirs = checkoutDirs(target.dir);

  for (const { dep, name, range } of wanted) {
    if (inRange(resolvedVersion(copy, root, dep), range)) continue;

    const source = dirs
      .map((dir) => installedDir(dir, dep))
      .find((candidate) => fs.existsSync(candidate) && (name === null || readName(candidate) === name));

    if (source === undefined || !inRange(readVersion(source), range)) continue;

    const link = path.join(nested, dep);
    removeTree(link);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(source, link, DIR_LINK);
  }
}
