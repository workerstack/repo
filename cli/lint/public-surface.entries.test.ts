/** Which `exports` targets the walk takes, which package it reads, and how a file finds its package root. */
import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { removePlanted, tempDir, write } from "../fixtures/planted-repo.ts";
import { namesIn, packageOf, rel, unknownIn, withEntries } from "../fixtures/surface-package.ts";
import { packageRoot, publicSurface } from "./public-surface.ts";

afterEach(removePlanted);

/** An `exports` condition map. Conditions resolve in order, so `types` stays before `default`. */
const conditions = (types: string, runtime: string) => ({
  types,

  default: runtime,
});

const BUILD = { compilerOptions: { outDir: "dist", rootDir: "src" } };
const A = "export const a = 1;\n";
const EMPTY = { entries: new Map(), names: new Map(), unknown: [] };

it("maps a dist target of .js and .d.ts back to its source through tsconfig.build.json", () => {
  const root = packageOf(
    {
      exports: {
        "./a": conditions("./dist/lib/a.d.ts", "./dist/lib/a.js"),
        "./b": "./dist/lib/b.mjs",
        "./c": "./dist/lib/c.d.mts",
        "./plain": "./other/p.ts",
      },
    },
    {
      "other/p.ts": "export const p = 1;\n",
      "src/lib/a.ts": A,
      "src/lib/b.mts": "export const b = 1;\n",
      "src/lib/c.mts": "export const c = 1;\n",
      "tsconfig.build.json": BUILD,
    },
  );
  const surface = publicSurface(root);
  expect([...surface.entries].map(([key, files]) => [key, files.map((file) => rel(root, file))])).toStrictEqual([
    ["./a", ["src/lib/a.ts"]],
    ["./b", ["src/lib/b.mts"]],
    ["./c", ["src/lib/c.mts"]],
    ["./plain", ["other/p.ts"]],
  ]);
  expect(Object.keys(namesIn(root))).toStrictEqual(["src/lib/a.ts", "src/lib/b.mts", "src/lib/c.mts", "other/p.ts"]);
  expect(surface.unknown).toStrictEqual([]);
});

it("puts a mapped source that is not there in unknown", () => {
  const root = packageOf({ exports: { ".": "./dist/x.js" } }, { "tsconfig.build.json": BUILD });
  expect(unknownIn(root)).toStrictEqual([{ file: "src/x.ts", form: "src/x.ts", line: 1 }]);
});

it("takes a dist target as written when there is no build config, an unreadable one or one without both dirs", () => {
  const files = { "dist/x.js": "export const x = 1;\n" };
  const configs = [undefined, "{ // comment\n", { compilerOptions: { outDir: "dist" } }];
  for (const config of configs) {
    const root = packageOf({ exports: "./dist/x.js" }, { ...files, "tsconfig.build.json": config ?? "" });
    expect(namesIn(root)).toStrictEqual({ "dist/x.js": ["x"] });
  }
});

it("takes a target outside outDir as written", () => {
  const root = packageOf(
    { exports: { ".": "./elsewhere/x.js" } },
    { "elsewhere/x.js": "export const x = 1;\n", "tsconfig.build.json": BUILD },
  );
  expect(namesIn(root)).toStrictEqual({ "elsewhere/x.js": ["x"] });
});

const SKIPPED = {
  ".": conditions("./src/index.ts", "./src/index.ts"),
  "./data": "./data.json",
  "./dir": "./src",
  "./docs": "./README.md",
  "./fallback": ["./src/index.ts", { default: "./src/other.ts" }],
  "./lib/*": "./src/*.ts",
  "./none": null,
  "./package.json": "./package.json",
  "./star": "./src/*.js",
  "./tsconfig/*": "./tsconfig/*.json",
};

it("skips JSON, wildcard, directory, markdown and ./package.json targets", () => {
  const root = withEntries(SKIPPED, { "data.json": "{}", "src/index.ts": A, "src/other.ts": "export const o = 1;\n" });
  const surface = publicSurface(root);
  expect([...surface.entries.keys()]).toStrictEqual([".", "./fallback"]);
  expect(surface.entries.get(".")).toStrictEqual([path.join(root, "src/index.ts")]);
  expect(surface.entries.get("./fallback")?.map((file) => rel(root, file))).toStrictEqual([
    "src/index.ts",
    "src/other.ts",
  ]);
  expect(namesIn(root)).toStrictEqual({ "src/index.ts": ["a"], "src/other.ts": ["o"] });
});

it("reads exports written as a single path or as a map of conditions", () => {
  const single = packageOf({ exports: "./src/index.ts" }, { "src/index.ts": A });
  const mapped = packageOf(
    {
      exports: conditions("./src/index.ts", "./src/index.ts"),
    },
    { "src/index.ts": A },
  );
  for (const root of [single, mapped]) {
    expect(publicSurface(root).entries).toStrictEqual(new Map([[".", [path.join(root, "src/index.ts")]]]));
  }
});

it("has no surface for a package without exports, a private one, or a manifest that cannot be read", () => {
  const none = packageOf({}, { "src/index.ts": A });
  const hidden = packageOf({ exports: "./src/index.ts", private: true }, { "src/index.ts": A });
  const missing = tempDir();
  const broken = tempDir();
  const list = tempDir();
  write(broken, { "package.json": "{ not json" });
  write(list, { "package.json": "[]" });
  for (const root of [none, hidden, missing, broken, list]) expect(publicSurface(root)).toStrictEqual(EMPTY);
});

it("treats a package with no private key and one with private false as public", () => {
  for (const manifest of [{}, { private: false }]) {
    const root = packageOf({ ...manifest, exports: "./src/index.ts" }, { "src/index.ts": A });
    expect(namesIn(root)).toStrictEqual({ "src/index.ts": ["a"] });
  }
});

it("reads the package again on each call and shares nothing between calls", () => {
  const root = packageOf({ exports: "./src/index.ts" }, { "src/index.ts": A });
  const first = publicSurface(root);
  fs.writeFileSync(path.join(root, "src/index.ts"), "export const b = 1;\n");
  expect(namesIn(root)).toStrictEqual({ "src/index.ts": ["b"] });
  expect(first).not.toBe(publicSurface(root));
});

it("finds the package of a nested workspace package from its own file", () => {
  const root = packageOf(
    { exports: "./src/index.ts" },
    {
      "packages/inner/lib.ts": "export const inner = 1;\n",
      "packages/inner/package.json": { exports: "./lib.ts", name: "inner" },
      "packages/inner/src/deep.ts": "export {};\n",
      "src/index.ts": "export {};\n",
    },
  );
  const inner = path.join(root, "packages/inner");
  expect(packageRoot(path.join(root, "src/index.ts"))).toBe(root);
  expect(packageRoot(path.join(inner, "src/deep.ts"))).toBe(inner);
  expect(namesIn(inner)).toStrictEqual({ "lib.ts": ["inner"] });
});

it("finds no package for a file outside any", () => {
  const outside = path.join(path.parse(process.cwd()).root, "no-such-dir-for-public-surface", "a.ts");
  expect(packageRoot(outside)).toBeNull();
});
