import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { removeTree } from "../cli/remove-tree.ts";
import { rootEnv, rootPath } from "./temp-root-env.ts";

let dir = "";

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "temp-root-env-test-")));

  // os.tmpdir() reads TMPDIR on posix and TEMP, then TMP, on Windows.
  for (const name of ["TMPDIR", "TEMP", "TMP"]) vi.stubEnv(name, dir);
  vi.stubEnv("NODE_COMPILE_CACHE", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeTree(dir);
});

describe("the run root's path", () => {
  it("is repo-test-<pid> in the real temp dir, the same every time", () => {
    expect(rootPath()).toBe(path.join(dir, `repo-test-${process.pid}`));
    expect(rootPath()).toBe(rootPath());
    expect(rootPath(7)).toBe(path.join(dir, "repo-test-7"));
  });
});

describe("the env test processes get", () => {
  it("is the root as every temp variable, and the real compile cache", () => {
    const root = rootPath();
    const cache = path.join(dir, "node-compile-cache");
    expect(rootEnv()).toStrictEqual({ NODE_COMPILE_CACHE: cache, TEMP: root, TMP: root, TMPDIR: root });
  });

  it("keeps a compile cache the environment already names", () => {
    vi.stubEnv("NODE_COMPILE_CACHE", "/somewhere/else");
    expect(rootEnv().NODE_COMPILE_CACHE).toBe("/somewhere/else");
  });
});
