import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import { put, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { ignoreRepo } from "./__fixtures__/ignore-kit.ts";
import { realDir } from "./__fixtures__/real-dir.ts";
import { redundantIgnoreLines } from "./redundant-ignore-lines.ts";

useTempDirs();

function slashPath(dir: string, rel: string): string {
  return path.join(dir, rel).split(path.sep).join("/");
}
afterEach(() => {
  vi.unstubAllEnvs();
});

it("redundantIgnoreLines names the parent rule that already ignores each added line", () => {
  const r = ignoreRepo();
  expect(redundantIgnoreLines(path.join(r, "packages/a/.gitignore"), [".tmp/"])).toStrictEqual([
    { line: ".tmp/", rule: `${path.join(r, ".gitignore")}:1 .tmp/` },
  ]);
  expect(redundantIgnoreLines(path.join(r, "packages/c/sub/.gitignore"), ["dist-local/"])).toStrictEqual([
    { line: "dist-local/", rule: `${path.join(r, "packages/c/.gitignore")}:1 dist-local/` },
  ]);
});

it("redundantIgnoreLines names the parent rule in the real spelling for a target typed through an alias", () => {
  const r = ignoreRepo();
  expect(redundantIgnoreLines(path.join(aliasOf(r), "packages/a/.gitignore"), [".tmp/"])).toStrictEqual([
    { line: ".tmp/", rule: `${path.join(r, ".gitignore")}:1 .tmp/` },
  ]);
});

it("redundantIgnoreLines allows uncovered lines, globs, negations, mixed writes, the root file, non-git dirs", () => {
  const r = ignoreRepo();
  const a = path.join(r, "packages/a/.gitignore");
  expect(redundantIgnoreLines(a, ["dist-local/"])).toStrictEqual([]);
  expect(redundantIgnoreLines(a, ["*.tmp"])).toStrictEqual([]);
  expect(redundantIgnoreLines(a, ["!keep"])).toStrictEqual([]);
  expect(redundantIgnoreLines(a, [".tmp/", "out/"])).toStrictEqual([]);
  expect(redundantIgnoreLines(path.join(r, ".gitignore"), [".tmp/"])).toStrictEqual([]);
  const loose = realDir("ignore-loose-");
  put(loose, ".gitignore", ".tmp/\n");
  expect(redundantIgnoreLines(path.join(loose, "a/.gitignore"), [".tmp/"])).toStrictEqual([]);
});

it("redundantIgnoreLines counts only the parent .gitignore files", () => {
  const r = ignoreRepo();
  const a = path.join(r, "packages/a/.gitignore");
  put(r, ".git/info/exclude", "secret/\n");
  const home = realDir("ignore-home-");
  put(home, "excludes", "secret/\n");
  put(home, "template/info/exclude", "secret/\n");
  put(
    home,
    "gitconfig",
    `[core]\n\texcludesFile = ${slashPath(home, "excludes")}\n[init]\n\ttemplateDir = ${slashPath(home, "template")}\n`,
  );
  vi.stubEnv("GIT_CONFIG_GLOBAL", path.join(home, "gitconfig"));
  expect(redundantIgnoreLines(a, ["secret/"])).toStrictEqual([]);
  put(r, "packages/a/.gitignore", "foo/\n");
  expect(redundantIgnoreLines(a, ["foo/"])).toStrictEqual([]);
  const other = ignoreRepo();
  vi.stubEnv("GIT_DIR", path.join(other, ".git"));
  expect(redundantIgnoreLines(a, [".tmp/"])).toStrictEqual([
    { line: ".tmp/", rule: `${path.join(r, ".gitignore")}:1 .tmp/` },
  ]);
});

it("redundantIgnoreLines keeps an unanchored line that a parent covers only at the top of its dir", () => {
  const r = ignoreRepo();
  put(r, ".gitignore", "/packages/a/build/\n");
  const a = path.join(r, "packages/a/.gitignore");
  expect(redundantIgnoreLines(a, ["build/"])).toStrictEqual([]);
  expect(redundantIgnoreLines(a, ["/build/"])).toStrictEqual([
    { line: "/build/", rule: `${path.join(r, ".gitignore")}:1 /packages/a/build/` },
  ]);
});
