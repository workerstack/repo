import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { KIT } from "./__fixtures__/deps-kit.ts";
import { useSurfaceOf } from "./__fixtures__/surface-kit.ts";

const surfaceOf = useSurfaceOf("type-surface-own-");

const INNER = { inner: { types: "export declare function inner(): number;\n" } };

const RUN = [
  'import { inner } from "inner";',
  "export function run(): number {",
  "  return inner();",
  "}",
  "export type R = number;",
  "",
].join("\n");

const MANIFEST = { bin: { pkg: "./bin.js" }, dependencies: { inner: "1.0.0" } };
const KIT_TYPE = 'import type { Kit } from "kit";\nexport type Api = Kit;\n';

it("scans the declarations of an own file a self-import reaches, never its function bodies", () => {
  const { uses, keys } = surfaceOf({
    files: { "src/index.ts": 'export type { R } from "pkg/run";\n', "src/run.ts": RUN },
    installed: INNER,
    manifest: { ...MANIFEST, exports: { ".": "./src/index.ts", "./run": "./src/run.ts" } },
  });

  expect(uses).toStrictEqual({});
  expect(keys).toStrictEqual({ "src/index.ts": ".", "src/run.ts": "./run" });
});

it("scans the declarations of an own file a tsconfig paths alias reaches", () => {
  const { uses, keys } = surfaceOf({
    files: { "src/index.ts": 'export type { R } from "@/run.ts";\n', "src/run.ts": RUN },
    installed: INNER,
    manifest: { ...MANIFEST, exports: { ".": "./src/index.ts" } },
    options: { paths: { "@/*": ["./src/*"] } },
  });

  expect(uses).toStrictEqual({});
  expect(keys).toStrictEqual({ "src/index.ts": ".", "src/run.ts": "." });
});

it("scans the declarations of an own file a package.json imports entry reaches", () => {
  const { uses, keys } = surfaceOf({
    files: { "src/index.ts": 'export type { R } from "#run";\n', "src/run.ts": RUN },
    installed: INNER,
    manifest: { ...MANIFEST, exports: { ".": "./src/index.ts" }, imports: { "#run": "./src/run.ts" } },
  });

  expect(uses).toStrictEqual({});
  expect(keys).toStrictEqual({ "src/index.ts": ".", "src/run.ts": "." });
});

it("scans a .tsx, .mts and .cts entry", () => {
  const { uses } = surfaceOf({
    files: { "src/a.tsx": KIT_TYPE, "src/b.mts": KIT_TYPE, "src/c.cts": KIT_TYPE },
    installed: KIT,
    manifest: {
      bin: { pkg: "./bin.js" },
      dependencies: { kit: "1.0.0" },
      exports: { "./a": "./src/a.tsx", "./b": "./src/b.mts", "./c": "./src/c.cts" },
    },
    options: { jsx: "preserve" },
  });

  expect(uses).toStrictEqual({ kit: ["src/a.tsx", "src/b.mts", "src/c.cts"] });
});

it("reads a json export or build config it cannot read as empty, and goes on", () => {
  const { uses, missing } = surfaceOf(
    {
      files: { "cfg.json/x": "", "tsconfig.build.json/x": "" },
      manifest: { exports: { "./cfg.json": "./cfg.json", "./client": { types: "./dist/client.d.ts" } } },
    },
    (dir) => fs.mkdirSync(path.join(dir, "dist")),
  );

  expect(uses).toStrictEqual({});
  expect(missing).toStrictEqual([{ cause: "unmapped", key: "./client", types: "dist/client.d.ts" }]);
});

const SIBLING = { "@s/b": "workspace:*", inner: "1.0.0" };

/** Links the workspace package at packages/b as the installed `@s/b`, as bun does. */
function linkSibling(dir: string): void {
  const scope = path.join(dir, "node_modules", "@s");

  fs.mkdirSync(scope);
  fs.symlinkSync(path.join(dir, "packages", "b"), path.join(scope, "b"));
}

it("counts a workspace package under the root's dir as that package, never as the root's own file", () => {
  const { uses, keys } = surfaceOf(
    {
      files: {
        "packages/b/package.json": JSON.stringify({ exports: { ".": "./src/index.ts" }, name: "@s/b" }),
        "packages/b/src/index.ts": `${RUN}export type B = { n: number };\n`,
        "src/index.ts": 'import type { B } from "@s/b";\nexport type A = B;\n',
      },
      installed: INNER,
      manifest: { ...MANIFEST, dependencies: SIBLING, exports: { ".": "./src/index.ts" } },
    },
    linkSibling,
  );

  expect(uses).toStrictEqual({ "@s/b": ["src/index.ts"] });
  expect(keys).toStrictEqual({ "src/index.ts": "." });
});
