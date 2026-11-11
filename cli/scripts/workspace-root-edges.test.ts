import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { useTempDirs } from "../sync/fixtures/temp-dirs.ts";
import { realDir as tmpDir } from "./fixtures/real-dir.ts";
import { canonicalPath, gitRevParse, resolveRoots, resolveTyped } from "./workspace-root.ts";

useTempDirs();
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canonicalPath", () => {
  it("returns a relative path, a non-string and a foreign-path-module path unchanged", () => {
    expect(canonicalPath("a/b")).toBe("a/b");
    expect(canonicalPath(7 /* a bad caller value */ as unknown /* typed as string by the signature */ as string)).toBe(
      7,
    );
    expect(canonicalPath("C:\\r\\x", path.win32)).toBe("C:\\r\\x");
  });

  it("spells the nearest existing ancestor with its real path and keeps the missing tail", () => {
    const dir = tmpDir("canon-real-");
    fs.mkdirSync(path.join(dir, "real"));
    fs.symlinkSync(path.join(dir, "real"), path.join(dir, "link"));
    expect(canonicalPath(path.join(dir, "link", "gone", "x.txt"))).toBe(path.join(dir, "real", "gone", "x.txt"));
  });

  it("returns the path unchanged when no ancestor exists", () => {
    const abs = path.resolve("/missing/top");
    expect(canonicalPath(abs, path, { exists: () => false, real: (p) => p })).toBe(abs);
  });

  it("returns the path unchanged when the real path of an existing ancestor cannot be read", () => {
    const abs = path.resolve("/missing/top");
    const real = () => {
      throw new Error("EACCES");
    };
    expect(canonicalPath(abs, path, { exists: () => true, real })).toBe(abs);
  });
});

describe("resolveTyped", () => {
  it("resolves a typed path against the roots cwd in the real spelling", () => {
    const dir = tmpDir("typed-");
    fs.mkdirSync(path.join(dir, "real"));
    fs.symlinkSync(path.join(dir, "real"), path.join(dir, "link"));
    expect(resolveTyped({ cwd: dir }, "link/new.txt")).toBe(path.join(dir, "real", "new.txt"));
    expect(resolveTyped({ cwd: "C:\\r" }, "src\\a.ts", path.win32)).toBe("C:\\r\\src\\a.ts");
  });
});

describe("gitRevParse", () => {
  it("is null when git prints fewer than three lines, and reads three as top, git dir and common dir", () => {
    const run = (out: string) => (() => out) /* a stand-in for execFileSync */ as never;
    expect(gitRevParse("/edge-short", run("/r\n/r/.git\n"))).toBeNull();
    expect(gitRevParse("/edge-full", run("/r\n/r/.git\n/r/.git\n"))).toStrictEqual({
      commonDir: "/r/.git",
      gitDir: "/r/.git",
      top: "/r",
    });
  });

  it("is null when git fails, and remembers the answer for the dir", () => {
    let calls = 0;
    const run = (() => {
      calls += 1;
      throw new Error("not a repo");
    }) /* a stand-in for execFileSync */ as never;
    expect(gitRevParse("/edge-fail", run)).toBeNull();
    expect(gitRevParse("/edge-fail", run)).toBeNull();
    expect(calls).toBe(1);
  });
});

describe("resolveRoots", () => {
  const facts = (top: string) => ({ commonDir: `${top}/.git`, gitDir: `${top}/.git`, top });

  it("falls back to the git top when the start dir is outside it", () => {
    const outside = tmpDir("roots-out-");
    const top = tmpDir("roots-top-");
    const roots = resolveRoots({ cwd: outside }, { cwd: outside, env: {}, git: () => facts(top) });
    expect(roots).toStrictEqual({ checkout: top, cwd: outside, root: top });
  });

  it("takes an empty call, a null input and a missing options argument from the process defaults", () => {
    const dir = tmpDir("roots-default-");
    const none = { cwd: dir, env: {}, git: () => null };
    expect(resolveRoots(undefined, none)).toStrictEqual({ checkout: dir, cwd: dir, root: dir });
    expect(resolveRoots(null, none).cwd).toBe(dir);
    // The real git runs here; a hook's git variables must not aim it at the repo being committed.
    vi.stubEnv("GIT_DIR", undefined);
    vi.stubEnv("GIT_INDEX_FILE", undefined);
    expect(resolveRoots({ workspaceRoot: dir }).cwd).toBe(dir);
  });

  it("reads the working directory from toolCall args and ignores an unusable workspacePaths", () => {
    const dir = tmpDir("roots-args-");
    const sub = path.join(dir, "sub");
    fs.mkdirSync(sub);
    const roots = resolveRoots(
      { toolCall: { args: { Cwd: sub } }, workspacePaths: "nope" /* a malformed hook input */ as never },
      { cwd: dir, env: {}, git: () => null },
    );
    expect(roots.cwd).toBe(sub);
  });
});
