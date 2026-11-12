import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { KIT } from "./__fixtures__/deps-kit.ts";
import { useSurfaceOf } from "./__fixtures__/surface-kit.ts";

const surfaceOf = useSurfaceOf("type-surface-");

const INDEX = [
  'import type { Kit } from "kit";',
  'import { inner } from "inner";',
  'import type { Order } from "./order.ts";',
  'import type { Gone } from "node:gone";',
  "export type Api = { kit: Kit; order: Order; gone: Gone };",
  "export function run(): number {",
  "  return inner();",
  "}",
  'export const make = (kit: import("kit").Kit): Promise<Kit> => Promise.resolve(kit);',
  "",
].join("\n");

const ORDER = 'import type { Kit } from "kit";\nexport type { Kit } from "kit";\nexport type Order = { of: Kit };\n';
const INNER = { inner: { types: "export declare function inner(): number;\n" } };
const KIT_TYPE = 'import type { Kit } from "kit";\nexport type Api = Kit;\n';

it("names a package an export type imports, with its files, and never one used only in a body", () => {
  const { dir, uses, keys, missing } = surfaceOf({
    files: { "src/index.ts": INDEX, "src/order.ts": ORDER },
    installed: { ...KIT, ...INNER },
    manifest: { dependencies: { absent: "1.0.0", inner: "1.0.0", kit: "1.0.0" }, exports: { ".": "./src/index.ts" } },
  });

  expect(uses).toStrictEqual({ kit: ["src/index.ts", "src/order.ts"] });
  expect(keys).toStrictEqual({ "src/index.ts": ".", "src/order.ts": "." });
  expect(missing).toStrictEqual([]);
  expect(fs.existsSync(path.join(dir, ".repo-surface"))).toBe(false);
});

it("names a package only a bare specifier reaches, whose declarations live in another package", () => {
  const { uses } = surfaceOf({
    files: { "src/index.ts": 'import type { Core } from "facade";\nexport type Api = Core;\n' },
    installed: {
      core: { types: "export type Core = { id: number };\n" },
      facade: { types: 'export * from "core";\n' },
    },
    manifest: { dependencies: { facade: "1.0.0" }, exports: "./src/index.ts" },
  });

  expect(uses).toStrictEqual({ core: ["src/index.ts"], facade: ["src/index.ts"] });
});

const TSCONFIG_EXPORTS = {
  "./data.json": "./data.json",
  "./package.json": "./package.json",
  "./tsconfig/base.json": "./tsconfig/base.json",
};

it("names a package a tsconfig export's d.ts references, and skips a json export's other files", () => {
  const { uses, keys } = surfaceOf({
    files: {
      "data.json": "[1]",
      "tsconfig/base.json": JSON.stringify({ files: ["./ref.d.ts", "./absent.d.ts", "./base.json", 7] }),
      "tsconfig/ref.d.ts": '/// <reference types="glob" />\n/// <reference types="nowhere" />\n',
    },
    installed: { glob: { types: "declare const globVersion: string;\n" } },
    manifest: { dependencies: { glob: "1.0.0" }, exports: TSCONFIG_EXPORTS, files: ["src", "dist/*.d.ts"] },
  });

  expect(uses).toStrictEqual({ glob: ["tsconfig/ref.d.ts"] });
  expect(keys).toStrictEqual({ "tsconfig/ref.d.ts": "./tsconfig/base.json" });
});

it("keys a file two exports reach by the nearer one, the earlier export winning a tie", () => {
  const { keys } = surfaceOf({
    files: {
      "src/a.ts": 'export type { Shared } from "./shared.ts";\n',
      "src/b.ts": 'export type { Deep } from "./deep.ts";\nexport type { Shared } from "./shared.ts";\n',
      "src/deep.ts": 'export type { Shared as Deep } from "./shared.ts";\n',
      "src/shared.ts": "export type Shared = { id: number };\n",
    },
    manifest: { exports: { "./a": "./src/a.ts", "./b": "./src/b.ts", "./deep": "./src/deep.ts" } },
  });

  expect(keys).toStrictEqual({ "src/a.ts": "./a", "src/b.ts": "./b", "src/deep.ts": "./deep", "src/shared.ts": "./a" });
});

it("names the dep that lists the package declaring a global, one hop up", () => {
  const { uses } = surfaceOf({
    files: { "src/index.ts": "export type Pattern = GlobPattern;\n" },
    installed: {
      "@types/glob": { dependencies: { "glob-types": "1.0.0" }, types: '/// <reference types="glob-types" />\n' },
      "glob-types": { types: "interface GlobPattern { source: string }\n" },
    },
    manifest: { dependencies: { "@types/glob": "1.0.0" }, exports: { ".": "./src/index.ts" } },
    options: { types: ["glob"] },
  });

  expect(uses).toStrictEqual({ "@types/glob": ["src/index.ts"], "glob-types": ["src/index.ts"] });
});

it("blames no parent for a package that is itself a dep", () => {
  const { uses } = surfaceOf({
    files: { "src/index.ts": KIT_TYPE },
    installed: { ...KIT, wrap: { dependencies: { kit: "1.0.0" }, types: "export {};\n" } },
    manifest: { dependencies: { kit: "1.0.0", wrap: "1.0.0" }, exports: { ".": "./src/index.ts" } },
  });

  expect(uses).toStrictEqual({ kit: ["src/index.ts"] });
});

it("blames no parent for a package the manifest declares as a peer", () => {
  const { uses } = surfaceOf({
    files: { "src/index.ts": KIT_TYPE },
    installed: { ...KIT, wrap: { dependencies: { kit: "1.0.0" }, types: "export {};\n" } },
    manifest: {
      dependencies: { wrap: "1.0.0" },
      exports: { ".": "./src/index.ts" },
      peerDependencies: { kit: "1.0.0" },
    },
  });

  expect(uses).toStrictEqual({ kit: ["src/index.ts"] });
});

it("maps a dist d.ts target to its source through tsconfig.build.json", () => {
  const { uses, missing } = surfaceOf({
    files: {
      "src/client.ts": KIT_TYPE,
      "tsconfig.build.json": JSON.stringify({ compilerOptions: { outDir: "dist", rootDir: "src" } }),
    },
    installed: KIT,
    manifest: { exports: { "./client": { default: "./dist/client.js", types: "./dist/client.d.ts" } } },
  });

  expect(uses).toStrictEqual({ kit: ["src/client.ts"] });
  expect(missing).toStrictEqual([]);
});

it("reads a d.ts target with no source as it is, under an unreadable tsconfig", () => {
  const { uses } = surfaceOf({
    files: { "tsconfig.build.json": "{}", "tsconfig.json": "{", "types/index.d.ts": KIT_TYPE },
    installed: KIT,
    manifest: { exports: { "./types": { default: "./types/index.js", types: "./types/index.d.ts" } } },
  });

  expect(uses).toStrictEqual({ kit: ["types/index.d.ts"] });
});

it("lists an export whose types file is absent and that no map points at a source", () => {
  const { uses, missing } = surfaceOf({
    manifest: {
      exports: {
        "./client": { default: "./dist/client.js", types: "./dist/client.d.ts" },
        "./gone": "./src/gone.ts",
        "./gone.json": "./gone.json",
        "./plain": "./plain.js",
      },
    },
  });

  expect(uses).toStrictEqual({});
  expect(missing).toStrictEqual([
    { cause: "unmapped", key: "./client", types: "dist/client.d.ts" },
    { cause: "source", key: "./gone", types: "src/gone.ts" },
  ]);
});
