/** The root dependency fields a workspace root leaves empty. */
export const ROOT_EMPTY_FIELDS: readonly ("dependencies" | "peerDependencies" | "optionalDependencies")[] = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];
/** The package dependency fields whose versions must come from a catalog, with the word a line uses for each. */
export const CATALOG_FIELDS: readonly (readonly [
  "dependencies" | "devDependencies" | "optionalDependencies",
  string,
])[] = [
  ["dependencies", ""],
  ["devDependencies", "devDependency "],
  ["optionalDependencies", "optionalDependency "],
];
/** The fields in which a manifest declares a dependency directly. */
export const DECLARING_FIELDS: readonly (
  | "dependencies"
  | "devDependencies"
  | "optionalDependencies"
  | "peerDependencies"
)[] = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
/** The one devDependency a workspace root keeps. */
export const ROOT_DEV_DEPENDENCY = "@workerstack/repo";
/** A version that points into a catalog. */
export const CATALOG_PREFIX = "catalog:";
/** A version that points at a workspace package. */
export const WORKSPACE_PREFIX = "workspace:";

/** The line for a workspace pack on a root with no `workspaces`. */
export const NEEDS_WORKSPACES =
  'the workspace pack needs "workspaces" in package.json; add it, or drop "workspace" from packs';
/** The line for a repo with no `bun.lock` and no `bun.lockb`. */
export const LOCK_MISSING = "bun.lock is missing; run `bun install`";
/** The line for a repo that keeps only the binary lockfile. */
export const LOCK_BINARY = "bun.lockb is binary; run `bun install --save-text-lockfile` and delete bun.lockb";

/** Where a dependency line points: the manifest file and the word for its field. */
export type Spot = { file: string; kind: string };

/** The line for a `bun.lock` that does not parse. */
export const lockUnparsable = (message: string): string =>
  `bun.lock does not parse (${message}); run \`bun install\` to rewrite it`;
/** The line for a root field that holds a dependency. */
export const rootField = (field: string, name: string): string =>
  `package.json: a workspace root has no "${field}"; move "${name}" into the package that uses it`;
/** The line for a root devDependency other than `@workerstack/repo`. */
export const rootDev = (name: string): string =>
  `package.json: the root's only devDependency is ${ROOT_DEV_DEPENDENCY}; move "${name}" into the package that uses it`;
/** The line for a dependency written as a range instead of `catalog:`. */
export const notCatalog = ({ file, kind }: Spot, name: string, version: string): string =>
  `${file}: ${kind}"${name}" is "${version}", not from the catalog; add it to the root catalog and write "catalog:"`;
/** The line for `catalog:` with no matching root catalog entry. */
export const noDefaultEntry = ({ file, kind }: Spot, name: string): string =>
  `${file}: ${kind}"${name}" is "catalog:", but the root catalog has no "${name}"; add it there`;
/** The line for `catalog:<catalog>` with no matching entry. */
export const noNamedEntry = ({ file, kind }: Spot, name: string, version: string): string =>
  `${file}: ${kind}"${name}" is "${version}", but there is no catalog "${version.slice(CATALOG_PREFIX.length)}" with "${name}"; add it to "catalogs"`;
/** The fix a stray version of `name` gets: an override, after a catalog entry when there is none. */
export const overrideFix = (name: string, inCatalog: boolean): string => {
  const override = `"overrides": { "${name}": "catalog:" }`;
  return inCatalog ? `add ${override} to the root package.json` : `add ${name} to the root catalog, then ${override}`;
};
