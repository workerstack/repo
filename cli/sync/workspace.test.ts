import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { tempDir, useTempDirs } from "./fixtures/temp-dirs.ts";
import { catalogsOf, readWorkspace } from "./workspace.ts";

useTempDirs();

/** A temp root holding each `files` entry, objects written as JSON. */
function repo(files: Record<string, object | string>): string {
  const root = tempDir("workerstack-workspace-");
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

function dirsOf(root: string, glob?: (pattern: string, cwd: string) => string[]): string[] {
  const result = readWorkspace(root, glob);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.workspace.packages.map((pkg) => pkg.dir);
}

it("reads a repo with no workspaces as the root alone", () => {
  const manifest = { dependencies: { "@workerstack/repo": "^1.0.0" }, name: "solo" };
  const root = repo({ "package.json": manifest });
  expect(readWorkspace(root)).toStrictEqual({ ok: true, workspace: { manifest, packages: [], root } });
});

it("keeps version, sideEffects, packageManager, bin and exports as they are written", () => {
  const manifest = {
    bin: { solo: "./bin/solo.ts" },
    exports: { "./lint": { default: "./lint.ts" } },
    name: "solo",
    packageManager: "bun@^1",
    sideEffects: ["*.css"],
    version: 3,
  };
  const root = repo({ "package.json": manifest });
  expect(readWorkspace(root)).toStrictEqual({ ok: true, workspace: { manifest, packages: [], root } });
});

it("reads a root without package.json as an empty manifest", () => {
  const root = repo({});
  expect(readWorkspace(root)).toStrictEqual({ ok: true, workspace: { manifest: {}, packages: [], root } });
});

it("expands an array of workspace globs into sorted package dirs with their manifests", () => {
  const root = repo({
    "apps/site/package.json": { name: "site" },
    "package.json": { name: "mono", workspaces: ["packages/*", "apps/*"] },
    "packages/api/package.json": { name: "@acme/api" },
    "packages/web/package.json": { devDependencies: { "@workerstack/ui": "1.0.0" }, name: "@acme/web" },
  });
  const result = readWorkspace(root);
  expect(result).toStrictEqual({
    ok: true,
    workspace: {
      manifest: { name: "mono", workspaces: ["packages/*", "apps/*"] },
      packages: [
        { dir: "apps/site", manifest: { name: "site" } },
        { dir: "packages/api", manifest: { name: "@acme/api" } },
        { dir: "packages/web", manifest: { devDependencies: { "@workerstack/ui": "1.0.0" }, name: "@acme/web" } },
      ],
      root,
    },
  });
});

it("expands the { packages } workspaces form", () => {
  const root = repo({
    "libs/core/package.json": { name: "core" },
    "package.json": { workspaces: { catalog: { zod: "^4.0.0" }, packages: ["libs/*"] } },
  });
  expect(dirsOf(root)).toStrictEqual(["libs/core"]);
});

it("drops dirs a ! pattern excludes", () => {
  const root = repo({
    "package.json": { workspaces: ["packages/*", "!packages/legacy"] },
    "packages/api/package.json": {},
    "packages/legacy/package.json": {},
  });
  expect(dirsOf(root)).toStrictEqual(["packages/api"]);
});

it("skips matched dirs without package.json, matched files and anything under node_modules", () => {
  const root = repo({
    "package.json": { workspaces: ["packages/*", "packages/**/deep", "./tools/*/"] },
    "packages/README.md": "a file",
    "packages/a/b/deep/package.json": {},
    "packages/api/node_modules/x/deep/package.json": {},
    "packages/api/package.json": {},
    "packages/node_modules/dep/package.json": {},
    "packages/notes/README.md": "no manifest",
    "tools/lint/package.json": {},
  });
  expect(dirsOf(root)).toStrictEqual(["packages/a/b/deep", "packages/api", "tools/lint"]);
});

it("lists a dir matched by two patterns once", () => {
  const root = repo({
    "package.json": { workspaces: ["packages/*", "packages/api"] },
    "packages/api/package.json": {},
  });
  expect(dirsOf(root)).toStrictEqual(["packages/api"]);
});

function backslashGlob(pattern: string): string[] {
  return pattern === "packages/*" ? ["packages\\web", "packages\\api\\", "packages\\old"] : ["packages\\old"];
}

it("normalizes backslash dirs from the glob to POSIX separators", () => {
  const root = repo({
    "package.json": { workspaces: ["packages/*", "!packages/old"] },
    "packages/api/package.json": {},
    "packages/old/package.json": {},
    "packages/web/package.json": {},
  });
  expect(dirsOf(root, backslashGlob)).toStrictEqual(["packages/api", "packages/web"]);
});

it("keeps a package's private flag and refuses one that is not true or false", () => {
  const root = repo({
    "package.json": { workspaces: ["packages/*"] },
    "packages/api/package.json": { private: true },
    "packages/web/package.json": {},
  });
  const result = readWorkspace(root);
  expect(result.ok && result.workspace.packages.map((pkg) => pkg.manifest.private)).toStrictEqual([true, undefined]);
  const bad = readWorkspace(repo({ "package.json": { private: "yes" } }));
  expect(!bad.ok && bad.errors).toStrictEqual(["package.json: private: must be true or false"]);
});

it("reports a root package.json that is not JSON", () => {
  const root = repo({ "package.json": "{ nope" });
  const result = readWorkspace(root);
  expect(result.ok).toBe(false);
  expect(!result.ok && result.errors).toStrictEqual([expect.stringMatching(/^package\.json: not valid JSON: .+/)]);
});

it("reports manifest fields of the wrong shape, naming the file and the field", () => {
  const root = repo({
    "package.json": { dependencies: { "@workerstack/repo": 1 }, workspaces: "packages/*" },
  });
  expect(readWorkspace(root)).toStrictEqual({
    errors: [
      'package.json: workspaces: must be a list of globs or { "packages": [...] }',
      "package.json: dependencies.@workerstack/repo: must be a version string",
    ],
    ok: false,
  });
});

it("reports a manifest that is not an object", () => {
  const root = repo({ "package.json": "[]" });
  expect(readWorkspace(root)).toStrictEqual({ errors: ["package.json: must be a JSON object"], ok: false });
});

it("reports every malformed workspace package manifest", () => {
  const root = repo({
    "package.json": { workspaces: ["packages/*"] },
    "packages/api/package.json": { name: 7 },
    "packages/ok/package.json": {},
    "packages/web/package.json": "",
  });
  const result = readWorkspace(root);
  expect(result.ok).toBe(false);
  expect(!result.ok && result.errors).toStrictEqual([
    "packages/api/package.json: name: must be a string",
    expect.stringMatching(/^packages\/web\/package\.json: not valid JSON: .+/),
  ]);
});

it("keeps catalog, catalogs and overrides top-level and under workspaces", () => {
  const top = { catalog: { zod: "^4" }, catalogs: { legacy: { zod: "^3" } }, overrides: { zod: "catalog:" } };
  const root = repo({
    "libs/core/package.json": { name: "core" },
    "package.json": { ...top, workspaces: { packages: ["libs/*"], ...top } },
  });
  const result = readWorkspace(root);
  expect(result.ok && result.workspace.manifest).toStrictEqual({
    ...top,
    workspaces: { packages: ["libs/*"], ...top },
  });
});

it("refuses a catalog entry that is not a version string", () => {
  const root = repo({ "package.json": { catalog: { zod: 4 }, catalogs: { a: { b: 1 } }, overrides: [] } });
  const result = readWorkspace(root);
  expect(!result.ok && result.errors).toHaveLength(3);
});

it("is empty for a manifest without catalogs", () => {
  expect(catalogsOf({})).toStrictEqual({ default: {}, named: {} });
  expect(catalogsOf({ workspaces: ["a"] })).toStrictEqual({ default: {}, named: {} });
});

it("merges both places, the top level winning", () => {
  const manifest = {
    catalog: { zod: "^4" },
    catalogs: { legacy: { zod: "^3" } },
    workspaces: {
      catalog: { vitest: "^4", zod: "^1" },
      catalogs: { legacy: { a: "1" }, next: { b: "2" } },
    },
  };
  expect(catalogsOf(manifest)).toStrictEqual({
    default: { vitest: "^4", zod: "^4" },
    named: { legacy: { a: "1", zod: "^3" }, next: { b: "2" } },
  });
});
