import path from "node:path";

import { expect, it } from "vitest";

import { put, tempDir, useTempDirs } from "./sync/__fixtures__/temp-dirs.ts";
import { blame } from "./type-surface-blame.ts";

useTempDirs();

it("counts an undeclared package for the installed dep above it, and skips a dep installed nowhere up the tree", () => {
  const root = tempDir("blame-");
  put(root, "node_modules/real/package.json", JSON.stringify({ dependencies: { inner: "1" }, name: "real" }));
  const dir = path.join(root, "packages", "app");
  put(dir, "src/a.ts", "");

  const used = new Map([["inner", new Set(["src/a.ts"])]]);
  const manifest = { dependencies: { ghost: "1", real: "1" }, name: "app" };

  expect(blame(used, dir, manifest)).toStrictEqual(
    new Map([
      ["inner", ["src/a.ts"]],
      ["real", ["src/a.ts"]],
    ]),
  );
});
