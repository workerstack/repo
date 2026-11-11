import fs from "node:fs";
import path from "node:path";

import { LinkError } from "./link-error.ts";
import type { LinkRoots, LinkTarget } from "./link-io.types.ts";
import { noSibling, notPublished, publishesNothing } from "./link.constants.ts";
import { readWorkspace } from "./sync/workspace.ts";

/** What a name is looked up against: the config's mapped checkouts and the packages this repo depends on. */
export type LinkLookup = {
  roots: LinkRoots;
  /** `link` from workerstack.config.ts: package name to a checkout path relative to this checkout. */
  mapped: Readonly<Record<string, string>>;
  /** The names this checkout's package.json files declare as dependencies. */
  used: ReadonlySet<string>;
};

/** Every package a checkout publishes: its root package and its workspace packages, each with a name. */
function publishedIn(checkout: string): LinkTarget[] {
  const read = readWorkspace(checkout);
  if (!read.ok) return [];
  const { manifest, packages } = read.workspace;
  const all = [
    { dir: ".", name: manifest.name },
    ...packages.map((pkg) => ({ dir: pkg.dir, name: pkg.manifest.name })),
  ];
  return all.flatMap(({ dir, name }) =>
    name === undefined ? [] : [{ checkout, dir: path.join(checkout, dir), name }],
  );
}

/** The directories beside the main checkout, other than this repo's own checkouts, by name. */
function siblingDirs({ siblings, checkout, main, install }: LinkRoots): string[] {
  const ours = new Set([checkout, main, install]);
  return fs
    .readdirSync(siblings, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(siblings, entry.name))
    .filter((dir) => !ours.has(dir))
    .toSorted();
}

function mappedTargets(name: string, lookup: LinkLookup): LinkTarget[] | null {
  const rel = lookup.mapped[name];
  if (rel === undefined) return null;
  const checkout = path.resolve(lookup.roots.checkout, rel);
  const found = publishedIn(checkout).filter((target) => target.name === name);
  if (found.length === 0) throw new LinkError(notPublished(checkout, name));
  return found;
}

/**
 * The packages `name` stands for: the checkout the config maps a package name to, else the sibling that publishes that
 * name, else every package a sibling dir of that name publishes that this repo depends on. Throws a `LinkError` that
 * says what to do when none matches.
 */
export function resolveTargets(name: string, lookup: LinkLookup): LinkTarget[] {
  const mapped = mappedTargets(name, lookup);
  if (mapped !== null) return mapped;
  const dirs = siblingDirs(lookup.roots);
  const byName = dirs.flatMap(publishedIn).find((target) => target.name === name);
  if (byName !== undefined) return [byName];
  const dir = dirs.find((candidate) => path.basename(candidate) === name);
  if (dir === undefined) throw new LinkError(noSibling(lookup.roots.main, name));
  const used = publishedIn(dir).filter((target) => lookup.used.has(target.name));
  if (used.length === 0) throw new LinkError(publishesNothing(dir));
  return used;
}
