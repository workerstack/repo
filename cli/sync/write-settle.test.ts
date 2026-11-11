import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { expectMode, isWritable } from "./fixtures/file-mode.ts";
import { file, link } from "./fixtures/outputs-kit.ts";
import { put } from "./fixtures/temp-dirs.ts";
import { block, hook, seeded, tempRoot, useWriteSuite } from "./fixtures/write-kit.ts";
import { settleModes } from "./write-modes.ts";

useWriteSuite();

it("makes writable whole outputs read-only and leaves block outputs, links, their targets and missing paths", () => {
  const root = seeded();
  put(root, "b.txt", "b\n");
  put(root, "s1/f.txt", "f\n");
  put(root, ".githooks/pre-commit", "#!/bin/sh\n");
  const outputs = [file("a.txt"), hook(), block("b.txt"), link("tree/lnk", "../s1"), file("missing.txt")];
  expect(settleModes(root, outputs, "linux")).toStrictEqual([]);
  expectMode(root, "a.txt", 0o444);
  expectMode(root, ".githooks/pre-commit", 0o555);
  expect(isWritable(root, "b.txt")).toBe(true);
  expect(isWritable(root, "s1/f.txt")).toBe(true);
  expect(fs.lstatSync(path.join(root, "tree/lnk")).isSymbolicLink()).toBe(true);
  expect(fs.existsSync(path.join(root, "missing.txt"))).toBe(false);
});

it("leaves an executable output read-only without execute bits for win32, and is a no-op on a rerun", () => {
  const root = tempRoot();
  put(root, ".githooks/pre-commit", "#!/bin/sh\n");
  expect(settleModes(root, [hook()], "win32")).toStrictEqual([]);
  expect(settleModes(root, [hook()], "win32")).toStrictEqual([]);
  expectMode(root, ".githooks/pre-commit", 0o444);
});

it("returns one warning for each file it cannot make read-only", () => {
  const root = tempRoot();
  put(root, "a.txt", "a\n");
  put(root, "c.txt", "c\n");
  vi.spyOn(fs, "chmodSync").mockImplementation(() => {
    throw new Error("EPERM: operation not permitted, chmod");
  });
  expect(settleModes(root, [file("a.txt"), file("c.txt")], "linux")).toStrictEqual([
    "cannot make a.txt read-only: EPERM: operation not permitted, chmod",
    "cannot make c.txt read-only: EPERM: operation not permitted, chmod",
  ]);
});

it("makes a block output an older sync left read-only writable, 0644, and leaves a writable one as it is", () => {
  const root = tempRoot();
  put(root, "AGENTS.md", "a\n");
  put(root, "notes.md", "n\n");
  fs.chmodSync(path.join(root, "AGENTS.md"), 0o444);
  fs.chmodSync(path.join(root, "notes.md"), 0o600);
  expect(settleModes(root, [block("AGENTS.md"), block("notes.md")], "linux")).toStrictEqual([]);
  expectMode(root, "AGENTS.md", 0o644);
  expectMode(root, "notes.md", 0o600);
});

it("names a block output it cannot make writable", () => {
  const root = tempRoot();
  put(root, "AGENTS.md", "a\n");
  fs.chmodSync(path.join(root, "AGENTS.md"), 0o444);
  vi.spyOn(fs, "chmodSync").mockImplementation(() => {
    throw new Error("EPERM: operation not permitted, chmod");
  });
  expect(settleModes(root, [block("AGENTS.md")], "linux")).toStrictEqual([
    "cannot make AGENTS.md writable: EPERM: operation not permitted, chmod",
  ]);
});
