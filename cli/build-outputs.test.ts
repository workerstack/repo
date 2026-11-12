import path from "node:path";

import { expect, it } from "vitest";

import { useTempTree } from "./__fixtures__/temp-tree.ts";
import { buildOutputs } from "./build-outputs.ts";
import { posix } from "./ts-program.ts";

const tree = useTempTree("build-outputs-");
const CONFIG = JSON.stringify({ compilerOptions: { declaration: true, outDir: "lib", rootDir: "src" } });

it("maps each output a build config emits to its source, both in typescript's slash spelling", () => {
  const dir = tree({ "src/a.ts": "export const a = 1;\n", "tsconfig.build.json": CONFIG });
  const source = posix(path.join(dir, "src", "a.ts"));

  expect(buildOutputs(dir)?.get(posix(path.join(dir, "lib", "a.d.ts")))).toBe(source);
});

it("is undefined for a build config that does not parse, on every platform", () => {
  expect(buildOutputs(tree({ "tsconfig.build.json": "{ nope" }))).toBeUndefined();
});

it.skipIf(process.platform === "win32")(
  "reads a dir spelled with a backslash as typescript does, never tripping its own path assertion",
  () => {
    const root = tree({ "a\\b/tsconfig.build.json": "{ nope" });

    expect(buildOutputs(path.join(root, "a\\b"))).toBeUndefined();
  },
);
