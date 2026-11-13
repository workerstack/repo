import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { KnipIgnore } from "../knip-schema.ts";
import { tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { KNIP_CONFIG_PATH, KNIP_UNIGNORED_GLOB, knipConfig } from "./knip-config.ts";
import type { PackageJson, Workspace } from "./workspace.ts";

useTempDirs();

/** A temp root holding the empty `files`, and a workspace of its manifest and packages. */
function workspace(manifest: PackageJson, packages: Workspace["packages"], files: string[] = []): Workspace {
  const root = tempDir("workerstack-knip-config-");

  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), "");
  }

  return { manifest, packages, root };
}

const generated = z.looseObject({ workspaces: z.record(z.string(), z.unknown()) });

/** The generated config, parsed. */
function parsed(ws: Workspace, ignores: readonly KnipIgnore[] = []) {
  return generated.parse(JSON.parse(knipConfig(ws, ignores)));
}

const SCHEMA = "https://unpkg.com/knip@6/schema.json";
const FIXTURES = ["**/__fixtures__/**"];

const DEFAULT_ENTRIES = [
  "{index,cli,main}.{js,mjs,cjs,jsx,ts,tsx,mts,cts}!",
  "src/{index,cli,main}.{js,mjs,cjs,jsx,ts,tsx,mts,cts}!",
];

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
];

describe("the generated knip config: shape", () => {
  it("names its path and the unignored copies it makes", () => {
    expect([KNIP_CONFIG_PATH, KNIP_UNIGNORED_GLOB]).toStrictEqual(["knip.json", "knip.unignored-*.json"]);
  });

  it("points at the schema and turns every rule to error", () => {
    expect(parsed(workspace({}, []))).toMatchObject({
      $schema: SCHEMA,
      rules: Object.fromEntries(RULES.map((rule) => [rule, "error"])),
    });
  });

  it("is one root workspace for a single package, with workerstack.config.ts as an entry and fixtures ignored", () => {
    expect(parsed(workspace({}, []))).toMatchObject({
      workspaces: {
        ".": { entry: [...DEFAULT_ENTRIES, "workerstack.config.ts"], ignore: FIXTURES, ignoreBinaries: [] },
      },
    });
  });

  it("adds a workspace per package dir, without workerstack.config.ts, and ends with a newline", () => {
    const ws = workspace({}, [
      { dir: "packages/api", manifest: {} },
      { dir: "packages/web", manifest: {} },
    ]);

    const { workspaces } = parsed(ws);
    expect(Object.keys(workspaces)).toStrictEqual([".", "packages/api", "packages/web"]);
    expect(workspaces).toMatchObject({
      "packages/api": { entry: DEFAULT_ENTRIES, ignore: FIXTURES, ignoreBinaries: [] },
    });
    expect(knipConfig(ws, []).endsWith("}\n")).toBe(true);
  });
});

describe("the generated knip config: vitest", () => {
  it("makes every vitest config present an entry and a vitest config of its workspace", () => {
    const ws = workspace(
      {},
      [{ dir: "packages/api", manifest: {} }],
      ["vitest.config.ts", "vitest.e2e.config.ts", "vite.config.ts", "packages/api/vitest.unit.config.mts"],
    );

    expect(parsed(ws)).toMatchObject({
      workspaces: {
        ".": {
          entry: [...DEFAULT_ENTRIES, "workerstack.config.ts", "vitest.config.ts", "vitest.e2e.config.ts"],
          vitest: { config: ["vitest.config.ts", "vitest.e2e.config.ts"] },
        },
        "packages/api": {
          entry: [...DEFAULT_ENTRIES, "vitest.unit.config.mts"],
          vitest: { config: ["vitest.unit.config.mts"] },
        },
      },
    });
  });

  it("leaves the vitest plugin alone where no vitest config is", () => {
    expect(parsed(workspace({}, []))).not.toHaveProperty(["workspaces", ".", "vitest"]);
  });
});

describe("the generated knip config: evals", () => {
  it("makes evals/*/eval.ts a root entry after workerstack.config.ts when the root has an evals dir", () => {
    const ws = workspace({}, [{ dir: "packages/api", manifest: {} }], ["evals/routing/eval.ts"]);

    expect(parsed(ws)).toMatchObject({
      workspaces: {
        ".": { entry: [...DEFAULT_ENTRIES, "workerstack.config.ts", "evals/*/eval.ts"] },
        "packages/api": { entry: DEFAULT_ENTRIES },
      },
    });
  });

  it("adds no eval entry where the root has no evals dir", () => {
    expect(parsed(workspace({}, []))).toMatchObject({
      workspaces: { ".": { entry: [...DEFAULT_ENTRIES, "workerstack.config.ts"] } },
    });
  });
});

describe("the generated knip config: bins", () => {
  it("ignores the binaries a workspace's own manifest declares, as a map or a path, and no other's", () => {
    const ws = workspace({ bin: { other: "./bin/o.ts", repo: "./bin/repo.ts" } }, [
      { dir: "packages/a", manifest: { bin: "./bin.ts", name: "@scope/a" } },
      { dir: "packages/b", manifest: { bin: "./bin.ts" } },
      { dir: "packages/c", manifest: { name: "c" } },
    ]);

    expect(parsed(ws)).toMatchObject({
      workspaces: {
        ".": { ignoreBinaries: ["other", "repo"] },
        "packages/a": { ignoreBinaries: ["a"] },
        "packages/b": { ignoreBinaries: [] },
        "packages/c": { ignoreBinaries: [] },
      },
    });
  });
});

describe("the generated knip config: ignores", () => {
  it("maps ignores to ignoreFiles, ignoreDependencies and ignoreBinaries on the root alone", () => {
    const ws = workspace({ bin: { repo: "./bin/repo.ts" } }, [{ dir: "packages/a", manifest: {} }]);

    const config = parsed(ws, [
      { file: "src/old.ts", reason: "loaded by name" },
      { dependency: "oxlint", reason: "spawned by path" },
      { binary: "tsc", reason: "run by a hook" },
    ]);

    expect(config).toMatchObject({
      workspaces: {
        ".": {
          ignoreBinaries: ["repo", "tsc"],
          ignoreDependencies: ["@workerstack/repo", "oxlint"],
          ignoreFiles: ["src/old.ts"],
        },
      },
    });
    expect(config).not.toHaveProperty(["workspaces", "packages/a", "ignoreFiles"]);
  });

  it("writes no ignoreFiles for no ignores, and always ignores this package's own name as a dependency", () => {
    const config = parsed(workspace({}, [{ dir: "packages/a", manifest: {} }]));
    expect(config).not.toHaveProperty(["workspaces", ".", "ignoreFiles"]);
    expect(config).toMatchObject({ workspaces: { ".": { ignoreDependencies: ["@workerstack/repo"] } } });
    expect(config).not.toHaveProperty(["workspaces", "packages/a", "ignoreDependencies"]);
  });
});

describe("the generated knip config: the generated root vitest config", () => {
  const generatedHeader = "// @generated by @workerstack/repo\n";

  it("gives the same config before and after the root vitest.config.ts is generated", () => {
    const ws = workspace({}, [{ dir: "packages/a", manifest: {} }], ["vitest.e2e.config.ts"]);
    const first = knipConfig(ws, []);

    for (const header of [generatedHeader, "// Generated by repo sync. Do not edit.\n"]) {
      fs.writeFileSync(path.join(ws.root, "vitest.config.ts"), `${header}export default {};\n`);
      expect(knipConfig(ws, [])).toBe(first);
    }

    expect(parsed(ws)).toMatchObject({ workspaces: { ".": { vitest: { config: ["vitest.e2e.config.ts"] } } } });
  });

  it("still reads a hand-written root vitest.config.ts, and a generated one in a package dir", () => {
    const ws = workspace({}, [{ dir: "packages/a", manifest: {} }]);
    fs.mkdirSync(path.join(ws.root, "packages/a"), { recursive: true });
    fs.writeFileSync(path.join(ws.root, "vitest.config.ts"), "export default {};\n");
    fs.writeFileSync(path.join(ws.root, "packages/a/vitest.config.ts"), `${generatedHeader}export default {};\n`);
    expect(parsed(ws)).toMatchObject({
      workspaces: {
        ".": { vitest: { config: ["vitest.config.ts"] } },
        "packages/a": { vitest: { config: ["vitest.config.ts"] } },
      },
    });
  });
});
