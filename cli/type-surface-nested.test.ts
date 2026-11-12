import path from "node:path";

import { expect, it } from "vitest";

import { KIT, kitFiles } from "./__fixtures__/deps-kit.ts";
import { useSurfaceOf } from "./__fixtures__/surface-kit.ts";
import { useTempTree } from "./__fixtures__/temp-tree.ts";
import { readWorkspace } from "./sync/workspace.ts";
import { typeSurface } from "./type-surface.ts";

const surfaceOf = useSurfaceOf("type-surface-nested-");
const tree = useTempTree("type-surface-outside-");

const KIT_TYPE = 'import type { Kit } from "kit";\nexport type Api = Kit;\n';
const BASE = { bin: { pkg: "./bin.js" }, dependencies: { kit: "1.0.0" } };

it("reads a file under a nested package.json without a name as the package's own", () => {
  const { uses, keys } = surfaceOf({
    files: {
      "dist/cjs/index.d.ts": KIT_TYPE,
      "dist/cjs/package.json": '{"type":"commonjs"}',
      "src/index.ts": KIT_TYPE,
      "src/package.json": '{"type":"module"}',
    },
    installed: KIT,
    manifest: {
      ...BASE,
      exports: {
        ".": "./src/index.ts",
        "./cjs": { require: { default: "./dist/cjs/index.js", types: "./dist/cjs/index.d.ts" } },
      },
    },
  });

  expect(uses).toStrictEqual({ kit: ["dist/cjs/index.d.ts", "src/index.ts"] });
  expect(keys).toStrictEqual({ "dist/cjs/index.d.ts": "./cjs", "src/index.ts": "." });
});

it("counts a file outside the package and under no named package.json as no package", () => {
  const files = kitFiles({
    files: { "index.d.ts": 'export type { S } from "../shared/s.ts";\n' },
    manifest: { ...BASE, exports: { ".": { default: "./index.js", types: "./index.d.ts" } } },
  });

  const root = tree({
    ...Object.fromEntries(Object.entries(files).map(([name, text]) => [`pkg/${name}`, text])),
    "shared/package.json": '{"type":"module"}',
    "shared/s.ts": "export type S = { s: number };\n",
  });

  const dir = path.join(root, "pkg");
  const read = readWorkspace(dir);
  const { uses, keys } = typeSurface(dir, read.ok ? read.workspace.manifest : {});

  expect(Object.fromEntries(uses)).toStrictEqual({});
  expect(Object.fromEntries(keys)).toStrictEqual({ "index.d.ts": "." });
});
