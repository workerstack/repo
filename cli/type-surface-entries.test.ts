import { expect, it } from "vitest";

import { KIT } from "./__fixtures__/deps-kit.ts";
import { useSurfaceOf } from "./__fixtures__/surface-kit.ts";

const surfaceOf = useSurfaceOf("type-surface-entries-");

const KIT_TYPE = 'import type { Kit } from "kit";\nexport type Api = Kit;\n';
const BASE = { bin: { pkg: "./bin.js" }, dependencies: { kit: "1.0.0" } };
const STAR = { "./*": { default: "./dist/*.js", types: "./dist/*.d.ts" } };
const BUILD = JSON.stringify({ compilerOptions: { outDir: "dist", rootDir: "src" } });

it("expands a * export against the files on disk, skipping installed dirs", () => {
  const dist = surfaceOf({ files: { "dist/a.d.ts": KIT_TYPE }, installed: KIT, manifest: { ...BASE, exports: STAR } });

  const flat = surfaceOf({
    files: { "a.ts": KIT_TYPE, "docs/x.md": "" },
    installed: KIT,
    manifest: { ...BASE, exports: { "./*": "./*.ts" } },
  });

  expect(dist.uses).toStrictEqual({ kit: ["dist/a.d.ts"] });
  expect(dist.keys).toStrictEqual({ "dist/a.d.ts": "./a" });
  expect(flat.uses).toStrictEqual({ kit: ["a.ts"] });
  expect(flat.keys).toStrictEqual({ "a.ts": "./a" });
});

it("expands a * export of an unbuilt dist against the sources the build config emits there", () => {
  const { uses, keys } = surfaceOf({
    files: { "src/a.ts": KIT_TYPE, "tsconfig.build.json": BUILD },
    installed: KIT,
    manifest: { ...BASE, exports: STAR },
  });

  expect(uses).toStrictEqual({ kit: ["src/a.ts"] });
  expect(keys).toStrictEqual({ "src/a.ts": "./a" });
});

it("lists a * export that matches nothing, by whether a build config exists", () => {
  const bare = surfaceOf({ manifest: { ...BASE, exports: STAR } });
  const built = surfaceOf({ files: { "tsconfig.build.json": BUILD }, manifest: { ...BASE, exports: STAR } });

  expect(bare.missing).toStrictEqual([{ cause: "unmapped", key: "./*", types: "dist/*.d.ts" }]);
  expect(built.missing).toStrictEqual([{ cause: "unbuilt", key: "./*", types: "dist/*.d.ts" }]);
});

/** The compiler options a test build config sets, each a path or a mode name. */
type BuildOptions = Readonly<Record<string, string>>;

/** A build config over src with `options`. */
function buildConfig(options: BuildOptions): string {
  return JSON.stringify({ compilerOptions: options, include: ["src"] });
}

it("maps a declaration target through a build config with an inferred rootDir, a declarationDir or .tsx", () => {
  const typed = { ".": { default: "./dist/index.js", types: "./dist/index.d.ts" } };
  const declarationDir = buildConfig({ declarationDir: "dist", jsx: "preserve", outDir: "out" });

  const inferred = surfaceOf({
    files: { "src/index.ts": KIT_TYPE, "tsconfig.build.json": buildConfig({ outDir: "dist" }) },
    installed: KIT,
    manifest: { ...BASE, exports: typed },
  });

  const declared = surfaceOf({
    files: { "src/index.tsx": KIT_TYPE, "tsconfig.build.json": declarationDir },
    installed: KIT,
    manifest: { ...BASE, exports: typed },
    options: { jsx: "preserve" },
  });

  expect(inferred.uses).toStrictEqual({ kit: ["src/index.ts"] });
  expect(declared.uses).toStrictEqual({ kit: ["src/index.tsx"] });
});

it("lists a declaration target a build config emits nothing to as unbuilt", () => {
  const { missing } = surfaceOf({
    files: { "tsconfig.build.json": BUILD },
    manifest: { ...BASE, exports: { ".": { default: "./dist/index.js", types: "./dist/index.d.ts" } } },
  });

  expect(missing).toStrictEqual([{ cause: "unbuilt", key: ".", types: "dist/index.d.ts" }]);
});

it("takes the root entry from types, typings or a declaration beside main when there are no exports", () => {
  const files = { "lib/index.d.ts": KIT_TYPE };
  const types = surfaceOf({ files, installed: KIT, manifest: { ...BASE, types: "./lib/index.d.ts" } });
  const typings = surfaceOf({ files, installed: KIT, manifest: { ...BASE, typings: "./lib/index.d.ts" } });
  const main = surfaceOf({ files, installed: KIT, manifest: { ...BASE, main: "./lib/index.js" } });

  for (const seen of [types, typings, main]) expect(seen.keys).toStrictEqual({ "lib/index.d.ts": "." });
  expect(main.uses).toStrictEqual({ kit: ["lib/index.d.ts"] });
});

it("takes the types of an export with only non-standard conditions, and a declaration beside a .js target", () => {
  const { keys } = surfaceOf({
    files: { "lib/b.d.mts": KIT_TYPE, "lib/c.d.ts": KIT_TYPE, "src/a.ts": KIT_TYPE },
    installed: KIT,
    manifest: {
      ...BASE,
      exports: {
        "./a": { bun: "./src/a.ts", node: "./dist/a.js", types: "./src/a.ts" },
        "./b": "./lib/b.mjs",
        "./c": "./lib/c.js",
        "./d": "./lib/d.js",
      },
    },
  });

  expect(keys).toStrictEqual({ "lib/b.d.mts": "./b", "lib/c.d.ts": "./c", "src/a.ts": "./a" });
});

it("takes shipped declarations only from a json export that is a tsconfig, never the manifest", () => {
  const { keys } = surfaceOf({
    files: { "index.d.ts": KIT_TYPE },
    installed: KIT,
    manifest: {
      ...BASE,
      exports: { ".": { default: "./index.js", types: "./index.d.ts" }, "./package.json": "./package.json" },
      files: ["index.d.ts"],
    },
  });

  expect(keys).toStrictEqual({ "index.d.ts": "." });
});

it("reads no types from a css export, a condition object with no types or runtime target, or an array of them", () => {
  const { keys, missing } = surfaceOf({
    manifest: { ...BASE, exports: { "./a": [{ bun: "./a.js" }], "./b": { bun: "./b.js" }, "./c.css": "./c.css" } },
  });

  expect(keys).toStrictEqual({});
  expect(missing).toStrictEqual([]);
});

it("still maps a build config with an unknown option or an extends it cannot resolve", () => {
  const typed = { ".": { default: "./dist/client.js", types: "./dist/client.d.ts" } };
  const unknown = { compilerOptions: { notAnOption: true, outDir: "dist", rootDir: "src" } };
  const unresolved = { compilerOptions: { outDir: "dist", rootDir: "src" }, extends: "@tsconfig/absent/tsconfig.json" };

  for (const config of [unknown, unresolved]) {
    const { uses } = surfaceOf({
      files: { "src/client.ts": KIT_TYPE, "tsconfig.build.json": JSON.stringify(config) },
      installed: KIT,
      manifest: { ...BASE, exports: typed },
    });

    expect(uses).toStrictEqual({ kit: ["src/client.ts"] });
  }
});
