import path from "node:path";
import { expect, it } from "vitest";
import { aliasOf, removeAlias } from "../../dev/test-paths";
import { canonicalPath } from "./workspace-root.ts";
import { inDir, plant, plantFiles, useJobEnv } from "./fixtures/job-kit.ts";
import { parseArgv, resolveJobCwd, resolveUnder } from "./job-args.ts";

useJobEnv();

it("parseArgv reads the = forms, trims and lowercases the job, and keeps = inside a value", () => {
  expect(
    parseArgv(["--job= Slice ", "--query=a=b", "--path=src", "--cwd=pkg", "--stash= g7 ", "--from= 2", "--to=9 "]),
  ).toStrictEqual({
    job: "slice",
    query: "a=b",
    path: "src",
    glob: [],
    cwd: "pkg",
    stash: "g7",
    from: "2",
    to: "9",
    unknown: false,
  });
});

it("parseArgv reads the spaced forms of stash, from and to", () => {
  const parsed = parseArgv(["--job", "slice", "--stash", "g7", "--from", "3", "--to", "5"]);
  expect([parsed.job, parsed.stash, parsed.from, parsed.to, parsed.unknown]).toStrictEqual([
    "slice",
    "g7",
    "3",
    "5",
    false,
  ]);
});

it("parseArgv drops an empty glob and takes a flag with no value as empty", () => {
  expect(parseArgv(["--glob=", "--glob", "", "--glob", "*.md"]).glob).toStrictEqual(["*.md"]);
  const dangling = parseArgv(["--query", "x", "--job"]);
  expect([dangling.job, dangling.query, dangling.unknown]).toStrictEqual(["", "x", false]);
});

it("parseArgv marks a stray word or an unknown flag as unknown", () => {
  expect(parseArgv(["--job", "exec", "stray"]).unknown).toBe(true);
  expect(parseArgv(["--wat=1", "--job", "exec"]).unknown).toBe(true);
  expect(parseArgv(["--job", "exec"]).unknown).toBe(false);
});

it("resolveUnder keeps a path inside its root and refuses one that leaves it", () => {
  const dir = plant();
  plantFiles(dir, { "pkg/a.txt": "x" });
  expect(resolveUnder(dir)).toBe(dir);
  expect(resolveUnder(dir, "")).toBe(dir);
  expect(resolveUnder(dir, null)).toBe(dir);
  expect(resolveUnder(dir, "pkg")).toBe(path.join(dir, "pkg"));
  expect(resolveUnder(dir, ".")).toBe(dir);
  expect(resolveUnder(dir, "..")).toBeNull();
  expect(resolveUnder(dir, "pkg/../../x")).toBeNull();
  // /tmp is a link to /private/tmp on macOS: the answer is the canonical spelling of the dir asked for.
  const tmpUnderRoot = path.join(path.parse(dir).root, "tmp");
  expect(resolveUnder(path.parse(dir).root, "tmp")).toBe(canonicalPath(tmpUnderRoot));
});

it("resolveUnder and resolveJobCwd start from the process cwd when they are given no root", () => {
  const dir = plant();
  plantFiles(dir, { "pkg/a.txt": "x" });
  expect(inDir(dir, () => resolveUnder(undefined, "pkg"))).toBe(path.join(dir, "pkg"));
  expect(inDir(dir, () => resolveUnder(""))).toBe(dir);
  expect(inDir(dir, () => resolveJobCwd("pkg"))).toBe(path.join(dir, "pkg"));
  expect(inDir(dir, () => resolveJobCwd("..", ""))).toBeNull();
});

it("resolveJobCwd resolves against the workspace and sees through a symlinked spelling", () => {
  const dir = plant();
  plantFiles(dir, { "pkg/a.txt": "x" });
  const alias = aliasOf(dir);
  try {
    expect(resolveJobCwd(path.join(alias, "pkg"), dir)).toBe(path.join(dir, "pkg"));
    expect(resolveJobCwd("pkg", alias)).toBe(path.join(dir, "pkg"));
    expect(resolveJobCwd("../out", dir)).toBeNull();
  } finally {
    removeAlias(alias);
  }
});
