import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MANIFEST_REL, normalizeRel, prunePaths, readManifest, renderManifest } from "./manifest.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function rootWith(manifest: string | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-manifest-"));
  temps.push(root);
  if (manifest !== null) {
    fs.mkdirSync(path.join(root, ".repo/tmp"), { recursive: true });
    fs.writeFileSync(path.join(root, MANIFEST_REL), manifest);
  }
  return root;
}

describe("readManifest", () => {
  it("reads a valid manifest", () => {
    expect(readManifest(rootWith('{"version":1,"paths":["a","b/c"]}'))).toStrictEqual({
      version: 1,
      paths: ["a", "b/c"],
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
    expect(readManifest(rootWith(text))).toStrictEqual({ version: 1, paths: [] });
  });
});

describe("renderManifest", () => {
  it("sorts and dedupes so equal sets give equal bytes", () => {
    expect(renderManifest(["b", "a", "b"])).toBe(renderManifest(["a", "b"]));
    expect(JSON.parse(renderManifest(["b", "a"]))).toStrictEqual({ version: 1, paths: ["a", "b"] });
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
      version: 1 as const,
      paths: ["b", ".\\a\\x", "C:\\repo\\a\\y", "C:\\repo\\keep", "keep", "../out", "C:\\else\\z"],
    };
    expect(prunePaths(prev, ["keep"], "C:\\repo")).toStrictEqual(["a/x", "a/y", "b"]);
  });
});
