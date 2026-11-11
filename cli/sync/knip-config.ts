import fs from "node:fs";
import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import type { KnipIgnore } from "../knip-schema.ts";
import { isRecord } from "../lint/manifest.ts";
import { hasOwnedHeader } from "./header.ts";
import { KNIP_JSON_INDENT, KNIP_SCHEMA_URL } from "./knip-config.constants.ts";
import { FIXTURES } from "./oxlint-config.ts";
import { PACKAGE_NAME } from "./stock.ts";
import { VITEST_CONFIG_PATH } from "./vitest-projects.constants.ts";
import type { PackageJson, Workspace, WorkspacePackage } from "./workspace.ts";

/** The generated config sync writes at the root. */
export const KNIP_CONFIG_PATH = "knip.json";
/** The ignore-free copies `repo check` writes beside it for one run, each named for its process. */
export const KNIP_UNIGNORED_GLOB = "knip.unignored-*.json";
const ROOT = ".";
const VITEST_CONFIGS = "vitest*.config.*";

/** Every issue type knip 6.43.0 reports: each is an error, so none passes unseen. */
const RULES = [
  "files",
  "dependencies",
  "devDependencies",
  "optionalPeerDependencies",
  "unlisted",
  "binaries",
  "unresolved",
  "exports",
  "nsExports",
  "types",
  "nsTypes",
  "enumMembers",
  "namespaceMembers",
  "duplicates",
  "catalog",
  "catalogReferences",
  "cycles",
] as const;

/** The command names a manifest's `bin` makes: its keys, or the unscoped package name when `bin` is one path. */
function binNames(manifest: PackageJson): string[] {
  if (isRecord(manifest.bin)) return Object.keys(manifest.bin);
  if (typeof manifest.bin !== "string" || manifest.name === undefined) return [];
  return [path.posix.basename(manifest.name)];
}

/** The `vitest*.config.*` files directly in `dir`, sorted; the root's generated one is left out, so a sync before it exists and one after agree. */
function vitestConfigs(root: string, dir: string): string[] {
  return fs
    .globSync(VITEST_CONFIGS, { cwd: path.join(root, dir) })
    .filter((name) => dir !== ROOT || name !== VITEST_CONFIG_PATH || !isGenerated(path.join(root, name)))
    .sort();
}

/** Whether the file at `file` carries sync's header, as its root vitest config does. */
function isGenerated(file: string): boolean {
  return hasOwnedHeader(fs.readFileSync(file, "utf8"));
}

/** Knip's own default entries: an explicit `entry` replaces them, so every workspace lists them again. */
const DEFAULT_ENTRIES = [
  "{index,cli,main}.{js,mjs,cjs,jsx,ts,tsx,mts,cts}!",
  "src/{index,cli,main}.{js,mjs,cjs,jsx,ts,tsx,mts,cts}!",
];

type WorkspaceConfig = {
  entry: string[];
  vitest?: { config: string[] };
  ignore: string[];
  ignoreBinaries: string[];
  ignoreFiles?: string[];
  ignoreDependencies?: string[];
};

/** The entry, vitest and bin settings of one workspace; `extraEntry` is what only its kind adds. */
function workspaceConfig(root: string, pkg: WorkspacePackage, extraEntry: string[]): WorkspaceConfig {
  const { dir, manifest } = pkg;
  const configs = vitestConfigs(root, dir);
  return {
    entry: [...DEFAULT_ENTRIES, ...extraEntry, ...configs],
    ...(configs.length > 0 ? { vitest: { config: configs } } : {}),
    ignore: [FIXTURES],
    ignoreBinaries: binNames(manifest),
  };
}

/** The root workspace: its own settings and the `ignores`, each as the list knip takes for its kind. */
function rootConfig(workspace: Workspace, ignores: readonly KnipIgnore[]): WorkspaceConfig {
  const base = workspaceConfig(workspace.root, { dir: ROOT, manifest: workspace.manifest }, [CONFIG_FILE]);
  const files = ignores.flatMap((ignore) => ("file" in ignore ? [ignore.file] : []));
  const dependencies = ignores.flatMap((ignore) => ("dependency" in ignore ? [ignore.dependency] : []));
  const binaries = ignores.flatMap((ignore) => ("binary" in ignore ? [ignore.binary] : []));
  return {
    ...base,
    ignoreBinaries: [...base.ignoreBinaries, ...binaries],
    ...(files.length > 0 ? { ignoreFiles: files } : {}),
    // The generated git hooks run this package's bin, which knip cannot see.
    ignoreDependencies: [PACKAGE_NAME, ...dependencies],
  };
}

/**
 * The knip config of a workspace: every rule an error, each package dir a workspace of knip's default entries and its own (the root also
 * `workerstack.config.ts`), the vitest configs present read by knip's vitest plugin, fixtures ignored, a workspace's
 * own bins not reported, and the root carrying `ignores`. `repo check` passes none for its ignore-free run.
 */
export function knipConfig(workspace: Workspace, ignores: readonly KnipIgnore[]): string {
  const config = {
    $schema: KNIP_SCHEMA_URL,
    rules: Object.fromEntries(RULES.map((rule) => [rule, "error"])),
    workspaces: {
      [ROOT]: rootConfig(workspace, ignores),
      ...Object.fromEntries(workspace.packages.map((pkg) => [pkg.dir, workspaceConfig(workspace.root, pkg, [])])),
    },
  };
  return `${JSON.stringify(config, null, KNIP_JSON_INDENT)}\n`;
}
