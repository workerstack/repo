import fs from "node:fs";
import path from "node:path";
import {
  CATALOG_FIELDS,
  CATALOG_PREFIX,
  DECLARING_FIELDS,
  LOCK_BINARY,
  LOCK_MISSING,
  NEEDS_WORKSPACES,
  ROOT_DEV_DEPENDENCY,
  ROOT_EMPTY_FIELDS,
  WORKSPACE_PREFIX,
  lockUnparsable,
  noDefaultEntry,
  noNamedEntry,
  notCatalog,
  overrideFix,
  rootDev,
  rootField,
  TEST_CONFIG_FILE,
  TEST_SCRIPT,
  TEST_SCRIPT_TEXT,
  TYPECHECK_CONFIG_FILE,
  TYPECHECK_SCRIPT,
  TYPECHECK_SCRIPT_TEXT,
  missingScript,
} from "./check-workspace.constants.ts";
import type { Spot } from "./check-workspace.constants.ts";
import { catalogsOf } from "./sync/workspace.ts";
import type { Catalogs, PackageJson, Workspace, WorkspacePackage } from "./sync/workspace.ts";

/**
 * `repo check`'s workspace-pack lines, one per problem: the root's dependencies, each package's
 * dependencies against the catalogs, then the versions `bun.lock` resolves.
 */
export function checkWorkspace(root: string, { manifest, packages }: Workspace): string[] {
  if (manifest.workspaces === undefined) return [NEEDS_WORKSPACES];
  const catalogs = catalogsOf(manifest);
  const lines = rootLines(manifest);
  for (const pkg of packages) {
    lines.push(...packageLines(`${pkg.dir}/package.json`, pkg.manifest, catalogs), ...scriptLines(root, pkg));
  }
  return [...lines, ...lockLines(root, catalogs, declaredNames([manifest, ...packages.map((pkg) => pkg.manifest)]))];
}

function rootLines(manifest: PackageJson): string[] {
  const lines: string[] = [];
  for (const field of ROOT_EMPTY_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) lines.push(rootField(field, name));
  }
  for (const name of Object.keys(manifest.devDependencies ?? {})) {
    if (name !== ROOT_DEV_DEPENDENCY) lines.push(rootDev(name));
  }
  return lines;
}

function packageLines(file: string, manifest: PackageJson, catalogs: Catalogs): string[] {
  const lines: string[] = [];
  for (const [field, kind] of CATALOG_FIELDS) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      const line = dependencyLine({ file, kind }, [name, version], catalogs);
      if (line !== undefined) lines.push(line);
    }
  }
  return lines;
}

/** The scripts turbo runs, as (config file, script, text to add): a package with the file needs the script. */
const TURBO_SCRIPTS = [
  { config: TEST_CONFIG_FILE, script: TEST_SCRIPT, text: TEST_SCRIPT_TEXT },
  { config: TYPECHECK_CONFIG_FILE, script: TYPECHECK_SCRIPT, text: TYPECHECK_SCRIPT_TEXT },
] as const;

/** One line per script turbo would skip silently: the package has the config file but not the script. */
function scriptLines(root: string, { dir, manifest }: WorkspacePackage): string[] {
  const scripts = isRecord(manifest.scripts) ? manifest.scripts : {};
  return TURBO_SCRIPTS.filter(
    ({ config, script }) => fs.existsSync(path.join(root, dir, config)) && typeof scripts[script] !== "string",
  ).map((entry) => missingScript(`${dir}/package.json`, { dir, ...entry }));
}

function dependencyLine(spot: Spot, [name, version]: [string, string], catalogs: Catalogs): string | undefined {
  if (version.startsWith(WORKSPACE_PREFIX)) return undefined;
  if (!version.startsWith(CATALOG_PREFIX)) return notCatalog(spot, name, version);
  const catalog = version.slice(CATALOG_PREFIX.length);
  if (catalog === "") return name in catalogs.default ? undefined : noDefaultEntry(spot, name);
  return catalogs.named[catalog]?.[name] === undefined ? noNamedEntry(spot, name, version) : undefined;
}

function lockLines(root: string, catalogs: Catalogs, declared: Set<string>): string[] {
  const lock = path.join(root, "bun.lock");
  if (!fs.existsSync(lock)) return [fs.existsSync(path.join(root, "bun.lockb")) ? LOCK_BINARY : LOCK_MISSING];
  let parsed: unknown;
  try {
    parsed = Bun.JSONC.parse(fs.readFileSync(lock, "utf8"));
  } catch (error) {
    return [lockUnparsable(String(error))];
  }
  return versionLines(lockCopies(parsed), catalogs, declared);
}

/** Every locked copy of every name: the top-level one has no parent. */
type Copies = Map<string, { version: string; parent: string | undefined }[]>;

function lockCopies(lock: unknown): Copies {
  const copies: Copies = new Map();
  const table = isRecord(lock) && isRecord(lock.packages) ? lock.packages : {};
  for (const [key, value] of Object.entries(table)) {
    const spec = Array.isArray(value) ? String(value[0]) : "";
    const at = spec.lastIndexOf("@");
    if (at <= 0) continue;
    const name = spec.slice(0, at);
    const parent = key === name ? undefined : key.slice(0, key.length - name.length - 1);
    copies.set(name, [...(copies.get(name) ?? []), { version: spec.slice(at + 1), parent }]);
  }
  return copies;
}

function versionLines(copies: Copies, catalogs: Catalogs, declared: Set<string>): string[] {
  const lines: string[] = [];
  for (const [name, found] of [...copies].sort(([a], [b]) => a.localeCompare(b))) {
    if (!declared.has(name)) continue;
    const versions = [...new Set(found.map((copy) => copy.version))].sort();
    if (versions.length === 1) continue;
    const top = found.find((copy) => copy.parent === undefined)?.version;
    const pulls = found.filter((copy) => copy.parent !== undefined && copy.version !== top);
    const stray = pulls.map((copy) => `${copy.parent} pulls ${copy.version}`).join(", ");
    lines.push(`${name} resolves to ${listOf(versions)}; ${stray}; ${overrideFix(name, name in catalogs.default)}`);
  }
  return lines;
}

function listOf(items: string[]): string {
  const rest = [...items];
  const last = rest.pop();
  return rest.length === 1 ? `${rest[0]} and ${last}` : `${rest.join(", ")} and ${last}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Every name a manifest declares directly, in any dependency field. */
function declaredNames(manifests: PackageJson[]): Set<string> {
  const names = new Set<string>();
  for (const manifest of manifests) {
    for (const field of DECLARING_FIELDS) for (const name of Object.keys(manifest[field] ?? {})) names.add(name);
  }
  return names;
}
