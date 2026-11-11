import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { isRecord, readManifest } from "./manifest.ts";

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-lint-manifest-")));
afterAll(() => fs.rmSync(dir, { force: true, recursive: true }));

/** Writes `manifest` as a temp package.json and reads it back. */
function read(manifest: unknown) {
  const file = path.join(dir, `${fs.readdirSync(dir).length}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest));
  const result = readManifest(file);
  if (result === null) throw new Error("manifest unreadable");
  return result;
}

function shipped(manifest: unknown, files: string[]): string[] {
  const { ships } = read(manifest);
  return files.filter(ships);
}

describe("readManifest runtime and public", () => {
  it("splits runtime names from dev-only ones", () => {
    const manifest = read({
      dependencies: { a: "1" },
      devDependencies: { a: "1", b: "1" },
      optionalDependencies: { d: "1" },
      peerDependencies: { c: "1" },
      private: false,
    });
    expect(manifest.declared.toSorted()).toStrictEqual(["a", "a", "b", "c", "d"]);
    expect(manifest.devOnly).toStrictEqual(["b"]);
    expect(manifest.isPublic).toBe(true);
  });

  it.each([[{}], [{ private: true }], [{ private: "false" }]])("is private for %j", (manifest) => {
    expect(read(manifest).isPublic).toBe(false);
  });
});

describe("readManifest ships", () => {
  const tree = ["src/a.ts", "src/deep/b.ts", "lib/c.ts", "bin/x.ts", "README.md", "other/d.ts"];

  it("ships every source file without files, and never a test or a config", () => {
    expect(
      shipped({}, ["a.ts", "a.test.ts", "vitest.config.ts", "e2e/a.ts", "x/__fixtures__/a.ts", "a.md"]),
    ).toStrictEqual(["a.ts"]);
  });

  it.each([[{ files: "src" }], [{ files: 7 }]])("ignores files that is not a list: %j", (m) => {
    expect(shipped(m, ["a.ts"])).toStrictEqual(["a.ts"]);
  });

  it("ships only targets when files lists nothing usable", () => {
    expect(shipped({ files: [3, null], main: "a.ts" }, ["a.ts", "b.ts"])).toStrictEqual(["a.ts"]);
  });

  it("matches a file, a dir and a glob entry", () => {
    const files = ["./src/", "lib/c.ts", "bin/*.ts"];
    expect(shipped({ files }, tree)).toStrictEqual(["src/a.ts", "src/deep/b.ts", "lib/c.ts", "bin/x.ts"]);
  });

  it("matches ** across dirs, ? for one character and escapes dots", () => {
    expect(shipped({ files: ["**/b.ts", "l?b/*.ts"] }, [...tree, "xb.ts", "lib/cxts"])).toStrictEqual([
      "src/deep/b.ts",
      "lib/c.ts",
    ]);
    expect(shipped({ files: ["src/**"] }, ["src/a.ts", "src/deep/b.ts", "srcxa.ts"])).toStrictEqual([
      "src/a.ts",
      "src/deep/b.ts",
    ]);
    expect(shipped({ files: ["a.ts"] }, ["a.ts", "axts"])).toStrictEqual(["a.ts"]);
  });
});

describe("readManifest ships targets and exclusions", () => {
  const tree = ["src/a.ts", "src/deep/b.ts", "lib/c.ts", "bin/x.ts", "README.md", "other/d.ts"];

  it("drops what a ! entry matches, whatever order it is in", () => {
    expect(shipped({ files: ["!src/deep", "src", "!lib/*.ts", "lib"] }, tree)).toStrictEqual(["src/a.ts"]);
  });

  it("ships main, module, types, bin and export targets that files leaves out", () => {
    const manifest = {
      bin: { x: "bin/x.ts" },
      exports: { ".": { default: "./src/a.ts", types: ["./lib/c.ts"] }, "./package.json": "./package.json" },
      files: ["src"],
      main: "./lib/c.ts",
      module: "other/d.ts",
      types: 1,
    };
    expect(shipped(manifest, tree)).toStrictEqual(["src/a.ts", "src/deep/b.ts", "lib/c.ts", "bin/x.ts", "other/d.ts"]);
    expect(shipped({ bin: "bin/x.ts", exports: "./lib/c.ts", files: ["src"] }, tree)).toStrictEqual([
      "src/a.ts",
      "src/deep/b.ts",
      "lib/c.ts",
      "bin/x.ts",
    ]);
  });

  it("ships a target even under a ! entry", () => {
    expect(shipped({ files: ["src", "!src/deep"], main: "src/deep/b.ts" }, tree)).toStrictEqual([
      "src/a.ts",
      "src/deep/b.ts",
    ]);
  });
});

describe("isRecord", () => {
  it.each([[null], [[]], ["{}"], [1]])("rejects %j", (value) => {
    expect(isRecord(value)).toBe(false);
  });

  it("accepts a plain object", () => {
    expect(isRecord({ name: "a" })).toBe(true);
  });
});
