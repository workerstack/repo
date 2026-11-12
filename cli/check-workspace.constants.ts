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
export function lockUnparsable(message: string): string {
  return `bun.lock does not parse (${message}); run \`bun install\` to rewrite it`;
}

/** The line for a root field that holds a dependency. */
export function rootField(field: string, name: string): string {
  return `package.json: a workspace root has no "${field}"; move "${name}" into the package that uses it`;
}

/** The line for a root devDependency other than `@workerstack/repo`. */
export function rootDev(name: string): string {
  return (
    `package.json: the root's only devDependency is ${ROOT_DEV_DEPENDENCY}; ` +
    `move "${name}" into the package that uses it`
  );
}

/** The line for a dependency written as a range instead of `catalog:`. */
export function notCatalog({ file, kind }: Spot, name: string, version: string): string {
  return (
    `${file}: ${kind}"${name}" is "${version}", not from the catalog; ` +
    `add it to the root catalog and write "catalog:"`
  );
}

/** The line for `catalog:` with no matching root catalog entry. */
export function noDefaultEntry({ file, kind }: Spot, name: string): string {
  return `${file}: ${kind}"${name}" is "catalog:", but the root catalog has no "${name}"; add it there`;
}

/** The line for `catalog:<catalog>` with no matching entry. */
export function noNamedEntry({ file, kind }: Spot, name: string, version: string): string {
  const catalog = version.slice(CATALOG_PREFIX.length);

  return (
    `${file}: ${kind}"${name}" is "${version}", ` +
    `but there is no catalog "${catalog}" with "${name}"; add it to "catalogs"`
  );
}

/** The fix a stray version of `name` gets: an override, after an entry in the root `catalog` when it has none. */
export function overrideFix(name: string, catalog: Readonly<Record<string, string>>): string {
  const override = `"overrides": { "${name}": "catalog:" }`;

  if (name in catalog) return `add ${override} to the root package.json`;

  return `add ${name} to the root catalog, then ${override}`;
}

/** The config file that makes a package a vitest project, the script that runs it and the script text to add. */
export const TEST_CONFIG_FILE = "vitest.config.ts";
export const TEST_SCRIPT = "test";
export const TEST_SCRIPT_TEXT = "vitest run";

/** The config file that makes a package typechecked, the script that runs it and the script text to add. */
export const TYPECHECK_CONFIG_FILE = "tsconfig.json";
export const TYPECHECK_SCRIPT = "typecheck";
export const TYPECHECK_SCRIPT_TEXT = "tsc --noEmit";

/** The line for a package that has a config file but not the script turbo runs for it. */
export function missingScript(
  file: string,
  { dir, config, script, text }: { dir: string; config: string; script: string; text: string },
): string {
  return `${file}: ${dir} has a ${config} but no "${script}" script; add "${script}": "${text}"`;
}

/** The fields a consumer installs: a public package may not name a private workspace package in one. */
export const RUNTIME_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

/** What a root manifest's code moves into, in a public edge line. */
export const ROOT_PACKAGE = "the root package";

/** A private workspace package a public one names, the field it is in and where its code could move. */
export type Edge = { name: string; field: string; home: string };

/** The line for a public package that names a private workspace package where a consumer installs it. */
export function publicEdge(file: string, { name, field, home }: Edge): string {
  return (
    `${file}: "${name}" in ${field} is private in this workspace; a consumer cannot install it, ` +
    `so publish it with "private": false or move the code into ${home}`
  );
}
