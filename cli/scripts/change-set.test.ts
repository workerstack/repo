import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { changeSet, ownerOf } from "./change-set.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
}

function write(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

/** A temp git repo with `files` committed as its first commit. */
function repo(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-change-set-")));
  temps.push(root);
  git(root, "init", "-q", "-b", "main");
  write(root, { ".gitignore": "dist/\n", ...files });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

const PACKAGES = ["packages/api", "packages/api/inner", "packages/web"];
const BASE = {
  "packages/api/inner/y.ts": "y\n",
  "packages/api/src/x.ts": "x\n",
  "packages/web/z.ts": "z\n",
  "src/a.ts": "a\n",
  "src/b.ts": "b\n",
};

const rels = (result: ReturnType<typeof changeSet>) => (result.ok ? result.changes : result.errors);

it("--staged is the index against HEAD, deletions included, leaving unstaged and untracked files out", () => {
  const root = repo(BASE);
  write(root, { "loose.ts": "l\n", "packages/api/src/new.ts": "n\n", "src/a.ts": "a2\n", "src/b.ts": "b2\n" });
  git(root, "add", "src/a.ts", "packages/api/src/new.ts");
  git(root, "rm", "-q", "packages/web/z.ts");
  expect(rels(changeSet(root, { kind: "staged" }, PACKAGES))).toStrictEqual([
    { deleted: false, owner: "packages/api", rel: "packages/api/src/new.ts" },
    { deleted: true, owner: "packages/web", rel: "packages/web/z.ts" },
    { deleted: false, owner: "", rel: "src/a.ts" },
  ]);
});

it("--staged and the working tree work before the first commit", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-change-set-")));
  temps.push(root);
  git(root, "init", "-q");
  write(root, { "a.ts": "a\n" });
  git(root, "add", "a.ts");
  expect(rels(changeSet(root, { kind: "staged" }, []))).toStrictEqual([{ deleted: false, owner: "", rel: "a.ts" }]);
  write(root, { "b.ts": "b\n" });
  expect(rels(changeSet(root, { kind: "tree" }, []))).toStrictEqual([
    { deleted: false, owner: "", rel: "a.ts" },
    { deleted: false, owner: "", rel: "b.ts" },
  ]);
});

it("refuses each file with both staged and unstaged changes, naming the fix", () => {
  const root = repo(BASE);
  write(root, { "src/a.ts": "a2\n", "src/b.ts": "b2\n" });
  git(root, "add", "src/a.ts", "src/b.ts");
  write(root, { "src/a.ts": "a3\n", "src/b.ts": "b3\n" });
  expect(rels(changeSet(root, { kind: "staged" }, PACKAGES))).toStrictEqual([
    "src/a.ts has staged and unstaged changes; stage the rest (git add src/a.ts) or undo it",
    "src/b.ts has staged and unstaged changes; stage the rest (git add src/b.ts) or undo it",
  ]);
});

it("the working tree is tracked changes against HEAD, staged or not, plus untracked files git does not ignore", () => {
  const root = repo(BASE);
  write(root, { "dist/out.js": "o\n", "packages/web/w.ts": "w\n", "src/a.ts": "a2\n", "src/c.ts": "c\n" });
  write(root, { "src/b.ts": "b2\n" });
  git(root, "add", "src/b.ts");
  fs.rmSync(path.join(root, "packages/api/inner/y.ts"));
  expect(rels(changeSet(root, { kind: "tree" }, PACKAGES))).toStrictEqual([
    { deleted: true, owner: "packages/api/inner", rel: "packages/api/inner/y.ts" },
    { deleted: false, owner: "packages/web", rel: "packages/web/w.ts" },
    { deleted: false, owner: "", rel: "src/a.ts" },
    { deleted: false, owner: "", rel: "src/b.ts" },
    { deleted: false, owner: "", rel: "src/c.ts" },
  ]);
});

it("a clean tree is an empty change set", () => {
  expect(rels(changeSet(repo(BASE), { kind: "tree" }, PACKAGES))).toStrictEqual([]);
});

it("a path is every tracked and untracked file of the package owning it, not of a nested package", () => {
  const root = repo(BASE);
  write(root, { "packages/api/dist/x.js": "x\n", "packages/api/src/new.ts": "n\n" });
  fs.rmSync(path.join(root, "packages/api/src/x.ts"));
  expect(rels(changeSet(root, { kind: "package", rel: "packages/api/src" }, PACKAGES))).toStrictEqual([
    { deleted: false, owner: "packages/api", rel: "packages/api/src/new.ts" },
    { deleted: true, owner: "packages/api", rel: "packages/api/src/x.ts" },
  ]);
});

it("the root's path is every file outside the packages", () => {
  const root = repo(BASE);
  expect(rels(changeSet(root, { kind: "package", rel: "" }, PACKAGES))).toStrictEqual([
    { deleted: false, owner: "", rel: ".gitignore" },
    { deleted: false, owner: "", rel: "src/a.ts" },
    { deleted: false, owner: "", rel: "src/b.ts" },
  ]);
});

it("skips a nested checkout and a submodule, which are directories, not files", () => {
  const root = repo(BASE);
  const nested = path.join(root, "nested");
  fs.mkdirSync(nested);
  git(nested, "init", "-q");
  write(nested, { "n.ts": "n\n" });
  git(nested, "add", "n.ts");
  git(nested, "commit", "-q", "-m", "n");
  git(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", nested, "sub");
  expect(rels(changeSet(root, { kind: "tree" }, PACKAGES))).toStrictEqual([
    { deleted: false, owner: "", rel: ".gitmodules" },
  ]);
  expect(rels(changeSet(root, { kind: "staged" }, PACKAGES))).toStrictEqual([
    { deleted: false, owner: "", rel: ".gitmodules" },
  ]);
});

it("says when the root is not a git repo", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-change-set-")));
  temps.push(dir);
  expect(rels(changeSet(dir, { kind: "tree" }, []))).toStrictEqual([`${dir} is not in a git repo`]);
});

it("ownerOf is the deepest package holding the path, or the root", () => {
  expect(ownerOf("packages/api/inner/y.ts", PACKAGES)).toBe("packages/api/inner");
  expect(ownerOf("packages/api", PACKAGES)).toBe("packages/api");
  expect(ownerOf("packages/apix/a.ts", PACKAGES)).toBe("");
  expect(ownerOf("", PACKAGES)).toBe("");
});
