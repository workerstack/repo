import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const globs = z.array(z.string());
const versions = z.record(z.string(), z.string({ error: "must be a version string" }), {
  error: "must be an object of package versions",
});

const packageJsonSchema = z.object(
  {
    name: z.string({ error: "must be a string" }).optional(),
    private: z.boolean({ error: "must be true or false" }).optional(),
    workspaces: z
      .union([globs, z.object({ packages: globs.optional() })], {
        error: 'must be a list of globs or { "packages": [...] }',
      })
      .optional(),
    dependencies: versions.optional(),
    devDependencies: versions.optional(),
    peerDependencies: versions.optional(),
    optionalDependencies: versions.optional(),
  },
  { error: "must be a JSON object" },
);

/** The package.json fields repo sync reads; every other field is dropped at parse. */
export type PackageJson = z.output<typeof packageJsonSchema>;
export type WorkspacePackage = { dir: string; manifest: PackageJson };
/** A repo root and its workspace packages; `dir` is root-relative with POSIX separators. */
export type Workspace = { root: string; manifest: PackageJson; packages: WorkspacePackage[] };
export type WorkspaceResult = { ok: true; workspace: Workspace } | { ok: false; errors: string[] };
/** Expands one glob under `cwd` into the matching paths, relative to `cwd`. */
export type Glob = (pattern: string, cwd: string) => string[];

const globSync: Glob = (pattern, cwd) => fs.globSync(pattern, { cwd });

/** Reads the root package.json and every workspace package it declares, sorted by dir. */
export function readWorkspace(root: string, glob: Glob = globSync): WorkspaceResult {
  const rootFile = path.join(root, "package.json");
  // A root without package.json has no workspaces and no dependencies, as loadConfig reads it.
  const rootManifest: ManifestResult = fs.existsSync(rootFile)
    ? parseManifest("package.json", rootFile)
    : { ok: true, manifest: {} };
  if (!rootManifest.ok) return { ok: false, errors: rootManifest.errors };

  const errors: string[] = [];
  const packages: WorkspacePackage[] = [];
  for (const dir of expandWorkspaces(root, rootManifest.manifest, glob)) {
    const rel = `${dir}/package.json`;
    const manifest = parseManifest(rel, path.join(root, rel));
    if (manifest.ok) packages.push({ dir, manifest: manifest.manifest });
    else errors.push(...manifest.errors);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, workspace: { root, manifest: rootManifest.manifest, packages } };
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
    .sort();
}

/** `packages\api\` and `./packages/api/` both read `packages/api`. */
function toPosixDir(match: string): string {
  return path.posix.normalize(match.replaceAll("\\", "/")).replace(/\/+$/, "");
}

type ManifestResult = { ok: true; manifest: PackageJson } | { ok: false; errors: string[] };

function parseManifest(rel: string, file: string): ManifestResult {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { ok: false, errors: [`${rel}: not valid JSON: ${(error as Error).message}`] };
  }
  const parsed = packageJsonSchema.safeParse(raw);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => {
      const at = issue.path.join(".");
      return `${rel}: ${at ? `${at}: ` : ""}${issue.message}`;
    }),
  };
}
