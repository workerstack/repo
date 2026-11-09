import path from "node:path";
import { expect, it } from "vitest";
import { aliasOf, removeAlias } from "../../dev/test-paths";
import { inDir, plant, plantFiles, useJobEnv } from "./fixtures/job-kit.ts";
import {
  globMatch,
  globToRegExp,
  isHtml,
  looksHtmlOrUnbounded,
  MAX_STDOUT,
  parseArgv,
  resolveJobCwd,
  resolveUnder,
  shouldFallback,
} from "./job.ts";

useJobEnv();

it("parseArgv reads the = forms, trims and lowercases the job, and keeps = inside a value", () => {
  expect(
    parseArgv(["--job= Slice ", "--query=a=b", "--path=src", "--cwd=pkg", "--stash= g7 ", "--from= 2", "--to=9 "]),
  ).toEqual({
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
  expect([parsed.job, parsed.stash, parsed.from, parsed.to, parsed.unknown]).toEqual(["slice", "g7", "3", "5", false]);
});

it("parseArgv drops an empty glob and takes a flag with no value as empty", () => {
  expect(parseArgv(["--glob=", "--glob", "", "--glob", "*.md"]).glob).toEqual(["*.md"]);
  const dangling = parseArgv(["--query", "x", "--job"]);
  expect([dangling.job, dangling.query, dangling.unknown]).toEqual(["", "x", false]);
});

it("parseArgv marks a stray word or an unknown flag as unknown", () => {
  expect(parseArgv(["--job", "exec", "stray"]).unknown).toBe(true);
  expect(parseArgv(["--wat=1", "--job", "exec"]).unknown).toBe(true);
  expect(parseArgv(["--job", "exec"]).unknown).toBe(false);
});

it("shouldFallback lets bounded jobs through and refuses unknown jobs", () => {
  expect(shouldFallback("search", "gate-fat-tools")).toBe(false);
  expect(shouldFallback(" EXEC ", "echo hi")).toBe(false);
  expect(shouldFallback("web", "x")).toBe(true);
  expect(shouldFallback(undefined, "x")).toBe(true);
  expect(shouldFallback("exec", undefined)).toBe(true);
  expect(shouldFallback("search", "   ")).toBe(true);
});

it("shouldFallback needs a stash for slice and an http url for fetch", () => {
  expect(shouldFallback("slice", "", { stash: "g7k" })).toBe(false);
  expect(shouldFallback("slice", "", { stash: "  " })).toBe(true);
  expect(shouldFallback("slice", "")).toBe(true);
  expect(shouldFallback("fetch", " https://example.com/a")).toBe(false);
  expect(shouldFallback("fetch", "HTTP://example.com")).toBe(false);
  expect(shouldFallback("fetch", "ftp://example.com")).toBe(true);
  expect(shouldFallback("fetch", undefined)).toBe(true);
});

it("shouldFallback refuses downloads, html, lockfiles and .git", () => {
  const refused = [
    "curl x",
    "wget x",
    "echo <html>",
    "echo <!DOCTYPE html>",
    "cat bun.lock",
    "ls .git/hooks",
    "ls .git",
  ];
  for (const q of refused) expect(shouldFallback("exec", q), q).toBe(true);
  expect(shouldFallback("exec", "ls src\\.git\\x")).toBe(true);
  expect(shouldFallback("exec", "git status")).toBe(false);
  expect(shouldFallback("exec", "ls my.github")).toBe(false);
});

it("shouldFallback refuses the generated dirs as whole path segments only", () => {
  const dirs = ["node_modules", "dist", ".next", "build", "coverage"];
  for (const d of dirs) {
    expect(shouldFallback("exec", `ls ${d}`), d).toBe(true);
    expect(shouldFallback("exec", `ls ${d}/x`), d).toBe(true);
    expect(shouldFallback("exec", `ls a/${d}/x`), d).toBe(true);
    expect(shouldFallback("exec", `cat '${d}'`), d).toBe(true);
    expect(shouldFallback("exec", `ls ${d}er`), d).toBe(false);
    expect(shouldFallback("exec", `ls my${d}`), d).toBe(false);
  }
});

it("isHtml and looksHtmlOrUnbounded look at stdout and stderr together", () => {
  expect(isHtml("<HTML lang=en>", "")).toBe(true);
  expect(isHtml("", "<!DOCTYPE html>")).toBe(true);
  expect(isHtml("plain", undefined)).toBe(false);
  expect(looksHtmlOrUnbounded("x".repeat(MAX_STDOUT + 1), "")).toBe(true);
  expect(looksHtmlOrUnbounded("x".repeat(MAX_STDOUT), "")).toBe(false);
  expect(looksHtmlOrUnbounded("<html>", "")).toBe(true);
  expect(looksHtmlOrUnbounded(undefined, undefined)).toBe(false);
  expect(looksHtmlOrUnbounded("", "x".repeat(MAX_STDOUT + 1))).toBe(true);
});

it("globMatch matches a bare pattern at any depth and a slashed one from the top", () => {
  expect(globMatch("a/b/c.md", "*.md")).toBe(true);
  expect(globMatch("c.md", "*.md")).toBe(true);
  expect(globMatch("a/b/c.txt", "*.md")).toBe(false);
  expect(globMatch("sub\\c.md", "sub/*.md")).toBe(true);
  expect(globMatch("x/sub/c.md", "sub/*.md")).toBe(false);
  expect(globMatch("a/b/c.md", "")).toBe(false);
  expect(globMatch(undefined, "*.md")).toBe(false);
});

it("globToRegExp turns ** * ? and literals into a whole-path pattern", () => {
  expect(globToRegExp("src/**/x.ts").test("src/x.ts")).toBe(true);
  expect(globToRegExp("src/**/x.ts").test("src/a/b/x.ts")).toBe(true);
  expect(globToRegExp("src/**").test("src/a/b.ts")).toBe(true);
  expect(globToRegExp("src/*").test("src/a/b.ts")).toBe(false);
  expect(globToRegExp("a?c.ts").test("abc.ts")).toBe(true);
  expect(globToRegExp("a?c.ts").test("a/c.ts")).toBe(false);
  expect(globToRegExp("a.b+c").test("aXb+c")).toBe(false);
  expect(globToRegExp("a\\b").test("a/b")).toBe(true);
  expect(globToRegExp(undefined).test("")).toBe(true);
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
  expect(resolveUnder(path.parse(dir).root, "tmp")).toBe(path.join(path.parse(dir).root, "tmp"));
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
