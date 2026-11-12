import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { expectMode, isWritable, modeOf } from "./__fixtures__/file-mode.ts";
import { file, link } from "./__fixtures__/outputs-kit.ts";
import { put } from "./__fixtures__/temp-dirs.ts";
import {
  DEPS as deps,
  MANIFEST,
  block,
  failing,
  hook,
  lockLikeWin32,
  seeded,
  tempRoot,
  tree,
  useWriteSuite,
} from "./__fixtures__/write-kit.ts";
import { MANIFEST_REL } from "./manifest.ts";
import { ownedMode, settleModes } from "./write-modes.ts";
import { writeAll, writeOutput } from "./write.ts";

useWriteSuite();

function mode(root: string, rel: string): number {
  return fs.statSync(path.join(root, rel)).mode & 0o777;
}

// Windows has no execute bits; sync marks a hook in the index there instead.
it.skipIf(process.platform === "win32")(
  "makes an executable output 0555 on POSIX, a new file and a rewritten one alike",
  () => {
    const root = tempRoot();
    expect(writeOutput(root, hook("#!/bin/sh\n"), "linux")).toBeNull();
    expect(mode(root, ".githooks/pre-commit")).toBe(0o555);
    fs.chmodSync(path.join(root, ".githooks/pre-commit"), 0o644);
    expect(writeOutput(root, hook("#!/bin/sh\nnew\n"), "darwin")).toBeNull();
    expect(mode(root, ".githooks/pre-commit")).toBe(0o555);
  },
);

it("leaves a plain output, and any output written for win32, which has no modes, without the execute bits", () => {
  const root = tempRoot();
  expect(writeOutput(root, file("a.txt"), "linux")).toBeNull();
  expect(mode(root, "a.txt") & 0o111).toBe(0);
  expect(writeOutput(root, hook("#!/bin/sh\n"), "win32")).toBeNull();
  expect(mode(root, ".githooks/pre-commit") & 0o111).toBe(0);
});

it("is 0444 for a whole file, 0555 for an executable one off win32, and default for a block output or a link", () => {
  expect(ownedMode(file("a.txt"), "linux")).toBe(0o444);
  expect(ownedMode(hook(), "darwin")).toBe(0o555);
  expect(ownedMode(hook(), "win32")).toBe(0o444);
  expect(ownedMode(block("b.txt"), "linux")).toBeNull();
  expect(ownedMode(link("l", "../s1"), "linux")).toBeNull();
});

it("leaves whole outputs read-only, an executable one 0555, and a block output and the manifest writable", () => {
  const root = tempRoot();
  expect(
    writeAll(root, { changed: [file("a.txt"), hook(), block("b.txt")], manifest: MANIFEST, prune: [] }, deps),
  ).toStrictEqual({ ok: true });
  expectMode(root, "a.txt", 0o444);
  expectMode(root, ".githooks/pre-commit", 0o555);
  expect(isWritable(root, "b.txt")).toBe(true);
  expect(isWritable(root, MANIFEST_REL)).toBe(true);
});

it("rewrites and prunes a read-only output where win32 refuses to replace or remove one", () => {
  const root = seeded();
  fs.chmodSync(path.join(root, "a.txt"), 0o444);
  fs.chmodSync(path.join(root, "gone/deep/x.txt"), 0o444);
  lockLikeWin32();
  expect(
    writeAll(root, { changed: [file("a.txt", "new a\n")], manifest: MANIFEST, prune: ["gone/deep/x.txt"] }, deps),
  ).toStrictEqual({ ok: true });
  expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("new a\n");
  expectMode(root, "a.txt", 0o444);
  expect(fs.existsSync(path.join(root, "gone"))).toBe(false);
});

it("puts a read-only output back read-only when a later write fails", () => {
  const root = seeded();
  fs.chmodSync(path.join(root, "a.txt"), 0o444);
  const before = tree(root);
  lockLikeWin32();

  const result = writeAll(
    root,
    { changed: [file("a.txt", "new\n"), file("c.txt")], manifest: MANIFEST, prune: [] },
    failing("c.txt"),
  );

  expect(result).toMatchObject({ errors: [expect.stringMatching(/restored 1 output, nothing changed$/)] });
  vi.restoreAllMocks();
  expect(tree(root)).toStrictEqual(before);
});

// A file link needs a privilege on win32; the dir links sync makes are covered below on every platform.
describe.skipIf(process.platform === "win32")("modes through a file link", () => {
  it("replaces a link at a whole output's path and leaves the read-only file it pointed to as it was", () => {
    const root = tempRoot();
    put(root, "real.txt", "mine\n");
    fs.chmodSync(path.join(root, "real.txt"), 0o444);
    fs.symlinkSync("real.txt", path.join(root, "l.txt"));
    expect(writeAll(root, { changed: [file("l.txt")], manifest: MANIFEST, prune: [] }, deps)).toStrictEqual({
      ok: true,
    });
    expect(fs.lstatSync(path.join(root, "l.txt")).isFile()).toBe(true);
    expectMode(root, "l.txt", 0o444);
    expectMode(root, "real.txt", 0o444);
  });

  it("never chmods the file a link at a whole output's path points to", () => {
    const root = tempRoot();
    put(root, "real.txt", "mine\n");
    const before = modeOf(root, "real.txt");
    fs.symlinkSync("real.txt", path.join(root, "l.txt"));
    expect(settleModes(root, [file("l.txt")], "linux")).toStrictEqual([]);
    expect(modeOf(root, "real.txt")).toBe(before);
  });
});
