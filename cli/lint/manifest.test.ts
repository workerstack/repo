import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readManifest } from "./manifest.ts";

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-lint-manifest-")));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Writes `manifest` as a temp package.json and reads it back. */
function read(manifest: unknown) {
  const file = path.join(dir, `${fs.readdirSync(dir).length}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest));
  const result = readManifest(file);
  if (result === null) throw new Error("manifest unreadable");
  return result;
}

const shipped = (manifest: unknown, files: string[]): string[] => {
  const { ships } = read(manifest);
  return files.filter(ships);
};

describe("readManifest runtime and public", () => {
  it("splits runtime names from dev-only ones", () => {
    const manifest = read({
      private: false,
      dependencies: { a: "1" },
      devDependencies: { b: "1", a: "1" },
      peerDependencies: { c: "1" },
      optionalDependencies: { d: "1" },
    });
    expect(manifest.declared.toSorted()).toEqual(["a", "a", "b", "c", "d"]);
    expect(manifest.devOnly).toEqual(["b"]);
    expect(manifest.isPublic).toBe(true);
  });

  it.each([[{}], [{ private: true }], [{ private: "false" }]])("is private for %j", (manifest) => {
    expect(read(manifest).isPublic).toBe(false);
  });
});

describe("readManifest ships", () => {
  const FILES = ["src/a.ts", "src/deep/b.ts", "lib/c.ts", "bin/x.ts", "README.md", "other/d.ts"];

  it("ships every source file without files, and never a test or a config", () => {
    expect(shipped({}, ["a.ts", "a.test.ts", "vitest.config.ts", "e2e/a.ts", "x/fixtures/a.ts", "a.md"])).toEqual([
      "a.ts",
    ]);
  });

  it.each([[{ files: "src" }], [{ files: 7 }]])("ignores files that is not a list: %j", (m) => {
    expect(shipped(m, ["a.ts"])).toEqual(["a.ts"]);
  });

  it("ships only targets when files lists nothing usable", () => {
    expect(shipped({ files: [3, null], main: "a.ts" }, ["a.ts", "b.ts"])).toEqual(["a.ts"]);
  });

  it("matches a file, a dir and a glob entry", () => {
    const files = ["./src/", "lib/c.ts", "bin/*.ts"];
    expect(shipped({ files }, FILES)).toEqual(["src/a.ts", "src/deep/b.ts", "lib/c.ts", "bin/x.ts"]);
  });

  it("matches ** across dirs, ? for one character and escapes dots", () => {
    expect(shipped({ files: ["**/b.ts", "l?b/*.ts"] }, [...FILES, "xb.ts", "lib/cxts"])).toEqual([
      "src/deep/b.ts",
      "lib/c.ts",
    ]);
    expect(shipped({ files: ["src/**"] }, ["src/a.ts", "src/deep/b.ts", "srcxa.ts"])).toEqual([
      "src/a.ts",
      "src/deep/b.ts",
    ]);
    expect(shipped({ files: ["a.ts"] }, ["a.ts", "axts"])).toEqual(["a.ts"]);
  });
});

describe("readManifest ships targets and exclusions", () => {
  const FILES = ["src/a.ts", "src/deep/b.ts", "lib/c.ts", "bin/x.ts", "README.md", "other/d.ts"];

  it("drops what a ! entry matches, whatever order it is in", () => {
    expect(shipped({ files: ["!src/deep", "src", "!lib/*.ts", "lib"] }, FILES)).toEqual(["src/a.ts"]);
  });

  it("ships main, module, types, bin and export targets that files leaves out", () => {
    const manifest = {
      files: ["src"],
      main: "./lib/c.ts",
      module: "other/d.ts",
      types: 1,
      bin: { x: "bin/x.ts" },
      exports: { ".": { default: "./src/a.ts", types: ["./lib/c.ts"] }, "./package.json": "./package.json" },
    };
    expect(shipped(manifest, FILES)).toEqual(["src/a.ts", "src/deep/b.ts", "lib/c.ts", "bin/x.ts", "other/d.ts"]);
    expect(shipped({ files: ["src"], bin: "bin/x.ts", exports: "./lib/c.ts" }, FILES)).toEqual([
      "src/a.ts",
      "src/deep/b.ts",
      "lib/c.ts",
      "bin/x.ts",
    ]);
  });

  it("ships a target even under a ! entry", () => {
    expect(shipped({ files: ["src", "!src/deep"], main: "src/deep/b.ts" }, FILES)).toEqual([
      "src/a.ts",
      "src/deep/b.ts",
    ]);
  });
});
