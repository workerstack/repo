import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { aliasOf, removeAlias } from "../../dev/test-paths";
import { inDir, plant, plantFiles, stashDirOf, useJobEnv } from "./__fixtures__/job-kit.ts";
import { resolveStashFile, writeStash } from "./job-stash.ts";
import { STASH_CAP, STASH_REL } from "./job.constants.ts";

useJobEnv();

it("writeStash saves the text under the root and names it relative to the root", () => {
  const dir = plant();
  const ref = writeStash({ cwd: dir }, "exec", "one\ntwo");
  expect(ref).toMatch(/^\.tmp\/repo\/stash\/exec-[0-9a-z]{4}\.txt$/);
  expect(fs.readFileSync(path.join(dir, ref), "utf8")).toBe("one\ntwo\n");
});

it("writeStash names the stash absolutely when the job runs away from the root", () => {
  const dir = plant();
  const sub = path.join(dir, "pkg");
  fs.mkdirSync(sub);
  const ref = writeStash({ cwd: sub, root: dir }, "search", "hit\n");
  expect(path.dirname(ref)).toBe(path.join(dir, STASH_REL));
  expect(fs.readFileSync(ref, "utf8")).toBe("hit\n");
});

it("writeStash takes the process cwd when it is given no places", () => {
  const dir = plant();
  const ref = inDir(dir, () => writeStash(undefined, "exec", "x"));
  expect(fs.readFileSync(path.join(dir, ref), "utf8")).toBe("x\n");
});

it("writeStash cuts a stash at the cap and writes an empty one for nothing", () => {
  const dir = plant();
  const big = writeStash({ cwd: dir, root: dir }, "exec", "x".repeat(STASH_CAP + 10));
  expect(fs.statSync(path.join(dir, big)).size).toBe(STASH_CAP + 1);
  const none = writeStash({ cwd: dir, root: dir }, "exec", undefined);
  expect(fs.readFileSync(path.join(dir, none), "utf8")).toBe("\n");
});

it("resolveStashFile finds a stash by id, by stem, by name or by part of the name", () => {
  const dir = plant();
  const stash = stashDirOf(dir);
  plantFiles(stash, { "exec-zz99.txt": "yo\n", "notes.md": "no\n", "search-ab12.txt": "hi\n" });
  const at = { cwd: dir, root: dir };
  expect(resolveStashFile(at, "ab12")).toBe(path.join(stash, "search-ab12.txt"));
  expect(resolveStashFile(at, "exec-zz99")).toBe(path.join(stash, "exec-zz99.txt"));
  expect(resolveStashFile(at, "exec-zz99.txt")).toBe(path.join(stash, "exec-zz99.txt"));
  expect(resolveStashFile(at, "notes.md")).toBe(path.join(stash, "notes.md"));
  expect(resolveStashFile(at, "notes")).toBeNull();
  expect(resolveStashFile(at, "nope")).toBeNull();
});

it("resolveStashFile says nothing for an empty id, a missing stash dir or an id that leaves it", () => {
  const dir = plant();
  const at = { cwd: dir, root: dir };
  expect(resolveStashFile(at, "")).toBeNull();
  expect(resolveStashFile(at, undefined)).toBeNull();
  expect(resolveStashFile(at, "ab12")).toBeNull();
  plantFiles(stashDirOf(dir), { "search-ab12.txt": "hi\n" });
  expect(resolveStashFile(at, "../stash/ab12")).toBeNull();
  expect(resolveStashFile(at, "a/b")).toBeNull();
  expect(resolveStashFile(at, "a\\b")).toBeNull();
});

it("resolveStashFile reads a path only when it is a file straight inside the root stash", () => {
  const dir = plant();
  const stash = stashDirOf(dir);
  plantFiles(stash, { "exec-q1.txt": "hi\n" });
  fs.mkdirSync(path.join(stash, "adir.txt"));
  plantFiles(dir, { "secret.txt": "no\n" });
  const at = { cwd: path.join(dir, "packages"), root: dir };
  const inside = path.join(stash, "exec-q1.txt");
  expect(resolveStashFile(at, inside)).toBe(inside);
  expect(resolveStashFile(at, `${STASH_REL}/exec-q1.txt`)).toBe(inside);
  expect(resolveStashFile(at, `${STASH_REL}/missing.txt`)).toBeNull();
  expect(resolveStashFile(at, path.join(stash, "adir.txt"))).toBeNull();
  expect(resolveStashFile(at, path.join(dir, "secret.txt"))).toBeNull();
  expect(resolveStashFile(at, `${STASH_REL}/../../../secret.txt`)).toBeNull();
});

it("resolveStashFile reads an absolute path in a symlinked spelling of the root", () => {
  const dir = plant();
  plantFiles(stashDirOf(dir), { "exec-q1.txt": "hi\n" });
  const alias = aliasOf(dir);
  try {
    const viaAlias = path.join(alias, STASH_REL, "exec-q1.txt");
    expect(resolveStashFile({ cwd: dir, root: dir }, viaAlias)).toBe(path.join(dir, STASH_REL, "exec-q1.txt"));
  } finally {
    removeAlias(alias);
  }
});

it("resolveStashFile takes the process cwd when it is given no places", () => {
  const dir = plant();
  const stash = stashDirOf(dir);
  plantFiles(stash, { "search-ab12.txt": "hi\n" });
  expect(inDir(dir, () => resolveStashFile(undefined, "ab12"))).toBe(path.join(stash, "search-ab12.txt"));
});
