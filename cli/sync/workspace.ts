import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { readJson } from "../json.ts";
import { errorMessage } from "../sync-errors.ts";
import { byCodeUnit } from "./by-code-unit.ts";

function versionsSchema() {
  return z.record(z.string(), z.string({ error: "must be a version string" }), {
    error: "must be an object of package versions",
  });
}

function catalogFields() {
  const versions = versionsSchema();

  return {
    catalog: versions.optional(),
    catalogs: z.record(z.string(), versions, { error: "must be an object of named catalogs" }).optional(),
    overrides: versions.optional(),
  };
}

const packageJsonSchema: z.ZodObject<{
  name: z.ZodOptional<z.ZodString>;
  private: z.ZodOptional<z.ZodBoolean>;
  version: z.ZodOptional<z.ZodUnknown>;
  sideEffects: z.ZodOptional<z.ZodUnknown>;
  packageManager: z.ZodOptional<z.ZodUnknown>;
  bin: z.ZodOptional<z.ZodUnknown>;
  exports: z.ZodOptional<z.ZodUnknown>;
  scripts: z.ZodOptional<z.ZodUnknown>;
  workspaces: z.ZodOptional<
    z.ZodUnion<
      readonly [
        z.ZodArray<z.ZodString>,
        z.ZodObject<{
          packages: z.ZodOptional<z.ZodArray<z.ZodString>>;
          catalog: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
          catalogs: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodString>>>;
          overrides: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }>,
      ]
    >
  >;
  catalog: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  catalogs: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodString>>>;
  overrides: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  dependencies: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  devDependencies: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  peerDependencies: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  optionalDependencies: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}> = /* @__PURE__ */ buildPackageJsonSchema();

function buildPackageJsonSchema() {
  const globs = z.array(z.string());
  const versions = versionsSchema();

  return z.object(
    {
      // Kept for the lint config, which narrows them where it reads them.
      bin: z.unknown().optional(),
      exports: z.unknown().optional(),
      name: z.string({ error: "must be a string" }).optional(),
      // Kept as written: sync accepts any value and only `repo check` judges these.
      packageManager: z.unknown().optional(),
      private: z.boolean({ error: "must be true or false" }).optional(),
      // Kept as written; `repo check` narrows the root's scripts where it reads them.
      scripts: z.unknown().optional(),
      sideEffects: z.unknown().optional(),
      version: z.unknown().optional(),
      workspaces: z
        .union([globs, z.object({ packages: globs.optional(), ...catalogFields() })], {
          error: 'must be a list of globs or { "packages": [...] }',
        })
        .optional(),
      ...catalogFields(),
      dependencies: versions.optional(),
      devDependencies: versions.optional(),
      optionalDependencies: versions.optional(),
      peerDependencies: versions.optional(),
    },
    { error: "must be a JSON object" },
  );
}

/**
 * The package.json fields repo sync reads; `version`, `sideEffects`, `packageManager`, `bin` and `exports` stay
 * unjudged `unknown`s; every other field is dropped at parse.
 */
export type PackageJson = z.output<typeof packageJsonSchema>;

export type WorkspacePackage = { dir: string; manifest: PackageJson };

/** A repo root and its workspace packages; `dir` is root-relative with POSIX separators. */
export type Workspace = { root: string; manifest: PackageJson; packages: WorkspacePackage[] };

export type WorkspaceResult = { ok: true; workspace: Workspace } | { ok: false; errors: string[] };

/**
 * The catalogs a root declares: `default` for `catalog:` and `named` for `catalog:<name>`; bun reads both top-level
 * and under `workspaces`, the top level winning an entry named in both.
 */
export type Catalogs = { default: Record<string, string>; named: Record<string, Record<string, string>> };

/** Expands one glob under `cwd` into the matching paths, relative to `cwd`. */
export type Glob = (pattern: string, cwd: string) => string[];

function globSync(pattern: string, cwd: string): string[] {
  return fs.globSync(pattern, { cwd });
}

/** Reads the root package.json and every workspace package it declares, sorted by dir. */
export function readWorkspace(root: string, glob: Glob = globSync): WorkspaceResult {
  const rootFile = path.join(root, "package.json");

  // A root without package.json has no workspaces and no dependencies, as loadConfig reads it.
  const rootManifest: ManifestResult = fs.existsSync(rootFile)
    ? parseManifest("package.json", rootFile)
    : { manifest: {}, ok: true };

  if (!rootManifest.ok) return { errors: rootManifest.errors, ok: false };

  const errors: string[] = [];
  const packages: WorkspacePackage[] = [];

  for (const dir of expandWorkspaces(root, rootManifest.manifest, glob)) {
    const rel = `${dir}/package.json`;
    const manifest = parseManifest(rel, path.join(root, rel));

    if (manifest.ok) packages.push({ dir, manifest: manifest.manifest });
    else errors.push(...manifest.errors);
  }

  if (errors.length > 0) return { errors, ok: false };

  return { ok: true, workspace: { manifest: rootManifest.manifest, packages, root } };
}

/** Merges the root's `catalog` and `catalogs` from both places bun reads them. */
export function catalogsOf(manifest: PackageJson): Catalogs {
  const inner = Array.isArray(manifest.workspaces) ? undefined : manifest.workspaces;
  const named: Catalogs["named"] = {};

  for (const source of [inner?.catalogs, manifest.catalogs])
    for (const [name, entries] of Object.entries(source ?? {})) named[name] = { ...named[name], ...entries };

  return { default: { ...inner?.catalog, ...manifest.catalog }, named };
}

/** Workspace dirs that hold a package.json, outside node_modules, deduped and sorted. */
function expandWorkspaces(root: string, manifest: PackageJson, glob: Glob): string[] {
  const workspaces = manifest.workspaces;
  const patterns = (Array.isArray(workspaces) ? workspaces : workspaces?.packages) ?? [];
  const included = new Set<string>();
  const excluded = new Set<string>();

  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const target = negated ? excluded : included;

    for (const match of glob(negated ? pattern.slice(1) : pattern, root)) target.add(toPosixDir(match));
  }

  return [...included]
    .filter((dir) => !excluded.has(dir))
    .filter((dir) => !dir.split("/").includes("node_modules"))
    .filter((dir) => fs.existsSync(path.join(root, dir, "package.json")))
    .toSorted(byCodeUnit);
}

/** `packages\api\` and `./packages/api/` both read `packages/api`. */
function toPosixDir(match: string): string {
  return path.posix.normalize(match.replaceAll("\\", "/")).replace(TRAILING_SLASHES, "");
}

const TRAILING_SLASHES = /\/+$/;

type ManifestResult = { ok: true; manifest: PackageJson } | { ok: false; errors: string[] };

function parseManifest(rel: string, file: string): ManifestResult {
  let raw: unknown;

  try {
    // Any JSON here; packageJsonSchema then words each issue as an error of its own.
    raw = readJson(z.json(), fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { errors: [`${rel}: not valid JSON: ${errorMessage(error)}`], ok: false };
  }

  const parsed = packageJsonSchema.safeParse(raw);

  if (parsed.success) return { manifest: parsed.data, ok: true };

  return {
    errors: parsed.error.issues.map((issue) => {
      const at = issue.path.join(".");

      return `${rel}: ${at === "" ? "" : `${at}: `}${issue.message}`;
    }),
    ok: false,
  };
}
