import { describe, expect, it } from "vitest";

import { put, tempDir, useTempDirs } from "./fixtures/temp-dirs.ts";
import { MANIFEST_REL, normalizeRel, prunePaths, readManifest, renderManifest } from "./manifest.ts";

useTempDirs();

function rootWith(manifest: string | null): string {
  const root = tempDir("workerstack-manifest-");
  if (manifest !== null) put(root, MANIFEST_REL, manifest);
  return root;
}

describe("readManifest", () => {
  it("reads a valid manifest", () => {
    expect(readManifest(rootWith('{"version":1,"paths":["a","b/c"]}'))).toStrictEqual({
      paths: ["a", "b/c"],
      version: 1,
    });
  });

  it.each([
    null,
    "{",
    "null",
    "[]",
    '{"version":2,"paths":[]}',
    '{"version":1,"paths":"a"}',
    '{"version":1,"paths":[1]}',
  ])("reads %j as empty", (text) => {
    expect(readManifest(rootWith(text))).toStrictEqual({ paths: [], version: 1 });
  });
});

describe("renderManifest", () => {
  it("sorts and dedupes so equal sets give equal bytes", () => {
    expect(renderManifest(["b", "a", "b"])).toBe(renderManifest(["a", "b"]));
    expect(JSON.parse(renderManifest(["b", "a"]))).toStrictEqual({ paths: ["a", "b"], version: 1 });
    expect(renderManifest([]).endsWith("\n")).toBe(true);
  });
});

describe("normalizeRel", () => {
  it.each([
    ["a/b", "/r", "a/b"],
    ["a\\b\\c", "/r", "a/b/c"],
    [".\\a//b/./c", "/r", "a/b/c"],
    ["/r/a/b", "/r", "a/b"],
    ["\\r\\a\\b", "/r", "a/b"],
    ["C:\\Users\\x\\repo\\.claude\\a", "C:\\Users\\x\\repo", ".claude/a"],
    ["c:/users/X/REPO/a", "C:\\Users\\x\\repo\\", "a"],
    ["/R/a", "/r", null],
    ["/other/a", "/r", null],
    ["C:\\other\\a", "C:\\Users\\x\\repo", null],
    ["C:\\Users\\x\\repo", "C:\\Users\\x\\repo", null],
    ["../a", "/r", null],
    ["a\\..\\..\\b", "/r", null],
    ["", "/r", null],
    ["./", "/r", null],
  ])("%j under %j is %j", (raw, root, expected) => {
    expect(normalizeRel(raw, root)).toBe(expected);
  });
});

describe("prunePaths", () => {
  it("returns the sorted, normalized paths no output names", () => {
    const prev = {
      paths: ["b", ".\\a\\x", "C:\\repo\\a\\y", "C:\\repo\\keep", "keep", "../out", "C:\\else\\z"],
      version: 1 as const,
    };
    expect(prunePaths(prev, ["keep"], "C:\\repo")).toStrictEqual(["a/x", "a/y", "b"]);
  });
});
