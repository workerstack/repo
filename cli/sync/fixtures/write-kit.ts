// Trees, outputs and write seams for the write suites: a seeded tree, a byte-for-byte snapshot and failing writers.
import fs from "node:fs";
import path from "node:path";

import { afterEach, vi } from "vitest";

import { linkText } from "../../../dev/test-paths.ts";
import { MANIFEST_REL, renderManifest } from "../manifest.ts";
import type { Output } from "../outputs.ts";
import { type WriteDeps, writeOutput } from "../write.ts";
import { put, tempDir, useTempDirs } from "./temp-dirs.ts";

/** The manifest every write suite writes. */
export const MANIFEST: string = /* @__PURE__ */ renderManifest(["a.txt"]);
/** The real writer on this platform. */
export const DEPS: WriteDeps = { platform: process.platform, writeOutput };

/** Registers the removal of every temp dir and the restore of every spy after each test of the calling file. */
export function useWriteSuite(): void {
  useTempDirs();
  afterEach(() => {
    vi.restoreAllMocks();
  });
}

/** A new empty temp root for a write. */
export function tempRoot(): string {
  return tempDir("workerstack-write-");
}

function entryOf(abs: string): string {
  const stat = fs.lstatSync(abs);
  if (stat.isSymbolicLink()) return `link ${linkText(abs)}`;
  if (stat.isDirectory()) return "dir";
  return `file ${(stat.mode & 0o777).toString(8)} ${fs.readFileSync(abs, "latin1")}`;
}

/** Every path under `root` with its kind, bytes, link text and file mode, so a restore can be compared byte for byte. */
export function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of fs.readdirSync(root, { encoding: "utf8", recursive: true }).toSorted())
    out[rel] = entryOf(path.join(root, rel));
  return out;
}

/** The pre-commit hook output: whole, tracked and executable. */
export function hook(content = "#!/bin/sh\n"): Output {
  return { content, executable: true, kind: "file", managed: "whole", path: ".githooks/pre-commit", tracked: true };
}

/** A block output at `rel`, its content its own path and a newline. */
export function block(rel: string): Output {
  return { content: `${rel}\n`, kind: "file", managed: "block", path: rel, tracked: true };
}

/** A tree with an old file, an old link and a prunable file that is the only thing in its dirs. */
export function seeded(): string {
  const root = tempRoot();
  put(root, "a.txt", "old a\n");
  fs.chmodSync(path.join(root, "a.txt"), 0o750);
  fs.mkdirSync(path.join(root, "s1"));
  fs.mkdirSync(path.join(root, "s2"));
  fs.mkdirSync(path.join(root, "tree"));
  fs.symlinkSync("../s1", path.join(root, "tree/lnk"), "dir");
  put(root, "gone/deep/x.txt", "x\n");
  put(root, MANIFEST_REL, renderManifest(["gone/deep/x.txt"]));
  return root;
}

/** Fails the output at `target` with `message` and writes every other one for real. */
export function failing(target: string, message = "EACCES: permission denied"): WriteDeps {
  return {
    platform: process.platform,
    writeOutput: (root: string, output: Output, platform: NodeJS.Platform) =>
      output.path === target ? message : writeOutput(root, output, platform),
  };
}

function isLocked(target: fs.PathLike): boolean {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  return stat !== undefined && stat.isFile() && (stat.mode & 0o200) === 0;
}

/** Makes a rename onto a read-only file and its removal fail, as they do on win32. */
export function lockLikeWin32(): void {
  const rename = fs.renameSync;
  const rm = fs.rmSync;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (isLocked(to)) throw new Error("EPERM: operation not permitted, rename");
    rename(from, to);
  });
  vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
    if (isLocked(target)) throw new Error("EPERM: operation not permitted, unlink");
    rm(target, options);
  });
}

/** Makes the manifest's rename fail, as a locked `.repo/sync.json` does; every other rename goes through. */
export function failManifestRename(): void {
  const real = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (String(to).endsWith("sync.json")) throw new Error("EACCES: permission denied, rename");
    real(from, to);
  });
}
