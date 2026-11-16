import fs from "node:fs";
import path from "node:path";

import { GENERATED } from "../generated.constants.ts";
import { isRecord, isString } from "../json.ts";
import type { KnipIgnore } from "../knip-schema.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { hasOwnedHeader } from "./header.ts";
import { KNIP_JSON_INDENT, KNIP_SCHEMA_URL, TOOL_LOADED_GLOBS, TOOL_LOADED_SUFFIXES } from "./knip-config.constants.ts";
import { FIXTURES } from "./oxlint-config.ts";
import { PACKAGE_NAME } from "./package-name.constants.ts";
import { VITEST_CONFIG_PATH } from "./vitest-projects.constants.ts";
import type { PackageJson, Workspace, WorkspacePackage } from "./workspace.ts";

/** The generated config sync writes at the root. */
export const KNIP_CONFIG_PATH = "knip.jsonc";

/** The ignore-free copies `repo check` writes beside it for one run, each named for its process. */
export const KNIP_UNIGNORED_GLOB = "knip.unignored-*.jsonc";

/** The ignore-free copy of the knip config for the process `pid`. */
export function knipUnignoredPath(pid: number): string {
  return KNIP_UNIGNORED_GLOB.replace("*", String(pid));
}

const ROOT = ".";
const VITEST_CONFIGS = "vitest*.config.*";

/** The dir `repo eval` loads `<name>/eval.ts` from; knip cannot see that import. */
const EVALS_DIR = "evals";
const EVAL_ENTRY = `${EVALS_DIR}/*/eval.ts`;

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

  if (!isString(manifest.bin) || manifest.name === undefined) return [];

  return [path.posix.basename(manifest.name)];
}

/**
 * The `vitest*.config.*` files directly in `dir`, sorted; the root's generated one is left out, so a sync before it
 * exists and one after agree.
 */
function vitestConfigs(root: string, dir: string): string[] {
  return fs
    .globSync(VITEST_CONFIGS, { cwd: path.join(root, dir) })
    .filter((name) => dir !== ROOT || name !== VITEST_CONFIG_PATH || !isGenerated(path.join(root, name)))
    .toSorted(byCodeUnit);
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

/** The suffix of the configs the tool-loaded entries already hold, so no vitest one is listed twice. */
const TS_CONFIG_SUFFIX = ".config.ts";

type WorkspaceConfig = {
  entry: string[];
  vitest?: { config: string[] };
  ignore: string[];
  ignoreBinaries: string[];
  ignoreFiles?: string[];
  ignoreDependencies?: string[];
};

/** The entry, vitest and bin settings of one workspace; `extraEntry` is what it adds after knip's defaults. */
function workspaceConfig(root: string, pkg: WorkspacePackage, extraEntry: readonly string[]): WorkspaceConfig {
  const { dir, manifest } = pkg;
  const configs = vitestConfigs(root, dir);

  return {
    entry: [...DEFAULT_ENTRIES, ...extraEntry, ...configs.filter((name) => !name.endsWith(TS_CONFIG_SUFFIX))],
    ...(configs.length > 0 ? { vitest: { config: configs } } : {}),
    ignore: [FIXTURES, GENERATED],
    ignoreBinaries: binNames(manifest),
  };
}

/** The workspace dir a repo-relative `file` lies in: the longest package dir that prefixes it, else the root. */
function holderOf(workspace: Workspace, file: string): string {
  const dirs = workspace.packages.map((pkg) => pkg.dir).filter((dir) => file.startsWith(`${dir}/`));

  return dirs.toSorted((a, b) => b.length - a.length)[0] ?? ROOT;
}

/** The entries `files` (repo-relative) add to the workspace at `dir`, each relative to that dir. */
function heldEntries(workspace: Workspace, dir: string, files: readonly string[]): string[] {
  return files.filter((file) => holderOf(workspace, file) === dir).map((file) => path.posix.relative(dir, file));
}

/** The `*.config.ts` and `*.worker.ts` entries of the workspace at `dir`: the globs when `listed` is null. */
function toolLoadedEntries(workspace: Workspace, dir: string, listed: readonly string[] | null): readonly string[] {
  if (listed === null) return TOOL_LOADED_GLOBS;

  const loaded = listed.filter((file) => TOOL_LOADED_SUFFIXES.some((suffix) => file.endsWith(suffix)));

  return heldEntries(workspace, dir, loaded).toSorted(byCodeUnit);
}

/**
 * What the config is built from: the `knip.ignore` entries, the files git sees (null outside git), and the
 * repo-relative files of `lint.plugins`.
 */
type KnipSources = Readonly<{
  ignores: readonly KnipIgnore[];
  listed: readonly string[] | null;
  plugins: readonly string[];
}>;

/** The entries the workspace at `dir` adds after knip's defaults: its tool-loaded files, then its plugin files. */
function ownEntries(workspace: Workspace, dir: string, { listed, plugins }: KnipSources): string[] {
  return [...toolLoadedEntries(workspace, dir, listed), ...heldEntries(workspace, dir, plugins)];
}

/** The root workspace: its own settings and the `ignores`, each as the list knip takes for its kind. */
function rootConfig(workspace: Workspace, sources: KnipSources): WorkspaceConfig {
  const { ignores } = sources;
  const evals = fs.existsSync(path.join(workspace.root, EVALS_DIR)) ? [EVAL_ENTRY] : [];

  const base = workspaceConfig(workspace.root, { dir: ROOT, manifest: workspace.manifest }, [
    ...ownEntries(workspace, ROOT, sources),
    ...evals,
  ]);

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
 * The knip config of a workspace: every rule an error, each package dir a workspace of knip's default entries, and
 * each `*.config.ts` and `*.worker.ts` file of `sources.listed` it holds (tools load them by name or path, so nothing
 * imports them). `listed` is what git sees, so a gitignored one stays out; it is null outside git, where the two
 * globs stand for them. Then its own entries (the root also every `evals/<name>/eval.ts` when it has an `evals/`
 * dir), the vitest configs present read by knip's vitest plugin and an entry where they are not `*.config.ts` files,
 * fixtures ignored, a workspace's own bins not reported, and the root carrying `sources.ignores`. `repo check` passes
 * no ignores for its ignore-free run. Each of `sources.plugins` is an entry of the workspace holding it, relative to
 * that workspace's dir.
 */
export function knipConfig(workspace: Workspace, sources: KnipSources): string {
  const config = {
    $schema: KNIP_SCHEMA_URL,
    rules: Object.fromEntries(RULES.map((rule) => [rule, "error"])),
    workspaces: {
      [ROOT]: rootConfig(workspace, sources),
      ...Object.fromEntries(
        workspace.packages.map((pkg) => [
          pkg.dir,
          workspaceConfig(workspace.root, pkg, ownEntries(workspace, pkg.dir, sources)),
        ]),
      ),
    },
  };

  return `${JSON.stringify(config, null, KNIP_JSON_INDENT)}\n`;
}
