import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { useTempDirs } from "../sync/fixtures/temp-dirs.ts";
import { realDir as tmpDir } from "./fixtures/real-dir.ts";
import { canonicalPath, gitRevParse, INSTALL_MARKER, resolveRoots, resolveTyped } from "./workspace-root.ts";

useTempDirs();
afterEach(() => {
  vi.unstubAllEnvs();
});

function unreadableReal(): never {
  throw new Error("EACCES");
}

/** A stand-in for execFileSync that prints `out`. */
function printing(out: string) {
  return (() => out) /* a stand-in for execFileSync */ as never;
}

function factsAt(top: string) {
  return { commonDir: `${top}/.git`, gitDir: `${top}/.git`, top };
}

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
    expect(canonicalPath(abs, path, { exists: () => true, real: unreadableReal })).toBe(abs);
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
    expect(gitRevParse("/edge-short", printing("/r\n/r/.git\n"))).toBeNull();
    expect(gitRevParse("/edge-full", printing("/r\n/r/.git\n/r/.git\n"))).toStrictEqual({
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
  it("falls back to the git top when the start dir is outside it", () => {
    const outside = tmpDir("roots-out-");
    const top = tmpDir("roots-top-");
    const roots = resolveRoots({ cwd: outside }, { cwd: outside, env: {}, git: () => factsAt(top) });
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

describe("resolveRoots", () => {
  it("takes the first set candidate in D1 order", () => {
    const dirs = Array.from({ length: 7 }, (_, i) => tmpDir(`roots-order-${i}-`));
    const [ws, paths, grok, claude, cwd, agCwd, proc] = dirs /* Array.from made seven dirs */ as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const input = { cwd, toolCall: { args: { Cwd: agCwd } }, workspacePaths: [paths], workspaceRoot: ws };
    const env = { CLAUDE_PROJECT_DIR: claude, GROK_WORKSPACE_ROOT: grok };
    function rootOf(i: object, e: Partial<typeof env>) {
      return resolveRoots(i, { cwd: proc, env: e }).root;
    }
    expect(rootOf(input, env)).toBe(ws);
    expect(rootOf({ ...input, workspaceRoot: undefined, workspace_root: ws }, env)).toBe(ws);
    expect(rootOf({ ...input, workspaceRoot: undefined }, env)).toBe(paths);
    expect(rootOf({ ...input, workspacePaths: [`file://${paths}`], workspaceRoot: undefined }, env)).toBe(paths);
    expect(rootOf({ cwd, toolCall: input.toolCall }, env)).toBe(grok);
    expect(rootOf({ cwd }, { CLAUDE_PROJECT_DIR: claude, GROK_WORKSPACE_ROOT: grok })).toBe(grok);
    expect(rootOf({ cwd }, { CLAUDE_PROJECT_DIR: claude })).toBe(claude);
    expect(rootOf({ cwd, toolCall: input.toolCall }, {})).toBe(cwd);
    expect(rootOf({ toolCall: input.toolCall }, {})).toBe(agCwd);
    expect(rootOf({}, {})).toBe(proc);
    expect(resolveRoots({ toolCall: input.toolCall }, { cwd: proc, env: {} }).cwd).toBe(agCwd);
  });
});

describe("resolveRoots", () => {
  it("maps Windows git output with path.win32", () => {
    const facts: Record<string, { top: string; gitDir: string; commonDir: string }> = {
      "C:\\r\\.worktrees\\w\\src": {
        commonDir: "C:/r/.git",
        gitDir: "C:/r/.git/worktrees/w",
        top: "C:/r/.worktrees/w",
      },
      "C:\\r\\src": { commonDir: "C:/r/.git", gitDir: "C:/r/.git", top: "C:/r" },
    };
    const opts = {
      cwd: "C:\\r",
      env: {},
      exists: (abs: string) =>
        abs === path.win32.join("C:\\r", INSTALL_MARKER) ||
        abs === path.win32.join("C:\\r\\.worktrees\\w", INSTALL_MARKER),
      git: (dir: string) => facts[dir] ?? null,
      p: path.win32,
      realpath: (abs: string) => abs,
    };
    expect(resolveRoots({ cwd: "C:\\r\\.worktrees\\w\\src" }, opts)).toStrictEqual({
      checkout: "C:\\r\\.worktrees\\w",
      cwd: "C:\\r\\.worktrees\\w\\src",
      root: "C:\\r",
    });
    expect(resolveRoots({ cwd: "C:\\r\\src" }, opts).root).toBe("C:\\r");
  });
});
