import fs from "node:fs";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { inDir, pathSans, plant, plantFiles, stashDirOf, useJobEnv } from "./fixtures/job-kit.ts";
import { globMatch, globToRegExp, runSearch } from "./job-search.ts";

useJobEnv();
// With no rg on PATH the search walks the tree itself; job-rg.test.ts covers the rg arm.
beforeEach(() => {
  vi.stubEnv("PATH", pathSans("rtk", "rg"));
});

/** The fact lines of a search result, sorted, since a directory walk has no fixed order. */
function facts(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .sort();
}

const search = (dir: string, query: string, extra: { path?: string; glob?: string[] | string } = {}) =>
  runSearch(query, { cwd: dir, root: dir, ...extra });

it("runSearch lists each matching line with its file and line number", () => {
  const dir = plant();
  plantFiles(dir, { "a.txt": "hello\nnone\nsay hello\n", "sub/b.txt": "  hello there  \n" });
  const r = search(dir, "hel+o");
  expect(r.code).toBe(0);
  expect(r.text.split("\n")[0]).toBe("3 matches.");
  expect(facts(r.text)).toStrictEqual(["- a.txt:1 — hello", "- a.txt:3 — say hello", "- sub/b.txt:1 — hello there"]);
});

it("runSearch says so when nothing matches", () => {
  const dir = plant();
  plantFiles(dir, { "a.txt": "hello\n" });
  expect(search(dir, "zzz")).toStrictEqual({ fallback: false, text: "No matches.\n", code: 0 });
});

it("runSearch reads a query that is not a pattern as plain text", () => {
  const dir = plant();
  plantFiles(dir, { "a.txt": "f(x)\nplain\n" });
  expect(search(dir, "f(").text).toBe("1 match.\n- a.txt:1 — f(x)\n");
});

it("runSearch skips generated dirs, .git, binary files, big files and symlinks", () => {
  const dir = plant();
  const skipped = ["node_modules/x.txt", "dist/x.txt", ".next/x.txt", "build/x.txt", "coverage/x.txt", ".git/x.txt"];
  plantFiles(dir, { "a.txt": "hello\n", "bin.dat": "hello\0\n", "big.txt": `hello\n${"x".repeat(201 * 1024)}` });
  plantFiles(dir, Object.fromEntries(skipped.map((rel) => [rel, "hello\n"])));
  if (process.platform !== "win32") fs.symlinkSync(path.join(dir, "a.txt"), path.join(dir, "link.txt"));
  expect(search(dir, "hello").text).toBe("1 match.\n- a.txt:1 — hello\n");
});

it("runSearch keeps a file whose size is just under the limit", () => {
  const dir = plant();
  plantFiles(dir, { "edge.txt": `hello\n${"x".repeat(200 * 1024 - 7)}` });
  expect(search(dir, "hello").text).toBe("1 match.\n- edge.txt:1 — hello\n");
});

it("runSearch limits the files by glob, as a list or as one string", () => {
  const dir = plant();
  plantFiles(dir, { "a.md": "hit\n", "sub/b.md": "hit\n", "c.txt": "hit\n", "sub/d.txt": "hit\n" });
  expect(facts(search(dir, "hit", { glob: ["*.md"] }).text)).toStrictEqual(["- a.md:1 — hit", "- sub/b.md:1 — hit"]);
  expect(facts(search(dir, "hit", { glob: "sub/*.txt" }).text)).toStrictEqual(["- sub/d.txt:1 — hit"]);
  expect(facts(search(dir, "hit", { glob: ["", "c.txt"] }).text)).toStrictEqual(["- c.txt:1 — hit"]);
  expect(search(dir, "hit", { glob: [] }).text.split("\n")[0]).toBe("4 matches.");
  expect(search(dir, "hit", { glob: "" }).text.split("\n")[0]).toBe("4 matches.");
});

it("runSearch limits the search to a path inside the cwd", () => {
  const dir = plant();
  plantFiles(dir, { "a.txt": "hit\n", "sub/b.txt": "hit\n" });
  expect(search(dir, "hit", { path: "sub" }).text).toBe("1 match.\n- sub/b.txt:1 — hit\n");
  expect(search(dir, "hit", { path: "a.txt" }).text).toBe("1 match.\n- a.txt:1 — hit\n");
  expect(search(dir, "hit", { path: "missing" }).text).toBe("No matches.\n");
  expect(search(dir, "hit", { path: "." }).text.split("\n")[0]).toBe("2 matches.");
});

it("runSearch falls back for a path outside the cwd", () => {
  const dir = plant();
  expect(search(dir, "hit", { path: ".." })).toStrictEqual({ fallback: true, text: "FALLBACK\n", code: 2 });
});

it("runSearch searches the process cwd and the root stash when given no places", () => {
  const dir = plant();
  plantFiles(dir, { "a.txt": "hit\n" });
  expect(inDir(dir, () => runSearch("hit")).text).toBe("1 match.\n- a.txt:1 — hit\n");
});

it.skipIf(process.platform === "win32")("runSearch skips a file or a dir it cannot read", () => {
  const dir = plant();
  plantFiles(dir, { "a.txt": "hit\n", "locked.txt": "hit\n", "closed/b.txt": "hit\n" });
  fs.chmodSync(path.join(dir, "locked.txt"), 0o000);
  fs.chmodSync(path.join(dir, "closed"), 0o000);
  try {
    expect(search(dir, "hit").text).toBe("1 match.\n- a.txt:1 — hit\n");
  } finally {
    fs.chmodSync(path.join(dir, "closed"), 0o755);
  }
});

it("runSearch stashes more than six matches and shows six", () => {
  const dir = plant();
  plantFiles(dir, { "big.txt": Array.from({ length: 20 }, (_, i) => `token-${i} hit`).join("\n") });
  const r = search(dir, "hit");
  const ref = /stash=(\S+)/.exec(r.text)?.[1] ?? "";
  expect(r.text.split("\n")[0]).toBe(`20 matches, 6 shown. stash=${ref}`);
  expect(ref).toMatch(/^\.tmp\/repo\/stash\/search-/);
  expect(fs.readFileSync(path.join(dir, ref), "utf8").split("\n").filter(Boolean)).toHaveLength(20);
  expect(fs.readdirSync(stashDirOf(dir))).toHaveLength(1);
});

it("runSearch stops at ten thousand matches across files and says more may follow", () => {
  const dir = plant();
  const block = "hit\n".repeat(6000);
  plantFiles(dir, { "a.txt": block, "b.txt": block, "c.txt": block });
  const r = search(dir, "hit");
  expect(r.text.split("\n")[0]).toMatch(/^10000\+ matches, 6 shown\. stash=/);
});

it("runSearch stops when the facts fill the stash cap, before ten thousand matches", () => {
  const dir = plant();
  plantFiles(dir, { [`${"f".repeat(200)}.txt`]: "hit\n".repeat(10_001) });
  const n = Number(/^(\d+)\+ matches/.exec(search(dir, "hit").text)?.[1]);
  expect(n).toBeGreaterThan(9000);
  expect(n).toBeLessThan(10_000);
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
