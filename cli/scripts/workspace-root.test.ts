import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { realDir as tmpDir } from "./__fixtures__/real-dir.ts";
import { canonicalPath, INSTALL_MARKER, resolveRoots } from "./workspace-root.ts";

useTempDirs();

function git(cwd: string, ...args: string[]) {
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "protocol.file.allow=always", ...args], {
    cwd,
    stdio: "ignore",
  });
}

function touch(root: string, rel: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "");
}

/** A committed repo with the repo marker at `markerAt` (relative; null for none) and `packages/a/`. */
function repo(prefix: string, markerAt: string | null = "") {
  const root = tmpDir(prefix);
  git(root, "init", "-q");

  if (markerAt !== null) touch(root, path.join(markerAt, INSTALL_MARKER));
  touch(root, "packages/a/index.js");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");

  return root;
}

const noEnv = {};

describe("resolveRoots", () => {
  it("gives the repo top for every root at the top of a plain repo", () => {
    const r = repo("roots-plain-");
    expect(resolveRoots({}, { cwd: r, env: noEnv })).toStrictEqual({ checkout: r, cwd: r, root: r });
  });

  it("keeps root and checkout at the top from a subdir, and cwd in the subdir", () => {
    const r = repo("roots-sub-");
    const a = path.join(r, "packages/a");
    expect(resolveRoots({ cwd: a }, { cwd: r, env: noEnv })).toStrictEqual({ checkout: r, cwd: a, root: r });
    expect(resolveRoots({}, { cwd: a, env: { CLAUDE_PROJECT_DIR: a } }).root).toBe(r);
  });

  it("puts root at the main checkout and checkout in a linked worktree", () => {
    const r = repo("roots-wt-");
    git(r, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
    const w = path.join(r, ".worktrees/w");
    expect(resolveRoots({ cwd: path.join(w, "packages/a") }, { cwd: r, env: noEnv })).toStrictEqual({
      checkout: w,
      cwd: path.join(w, "packages/a"),
      root: r,
    });
  });
});

describe("resolveRoots", () => {
  it("after EnterWorktree, takes root from the project dir and checkout from the hook cwd", () => {
    const r = repo("roots-enter-");
    git(r, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
    const w = path.join(r, ".worktrees/w");
    expect(resolveRoots({ cwd: w }, { cwd: r, env: { CLAUDE_PROJECT_DIR: r } })).toStrictEqual({
      checkout: w,
      cwd: w,
      root: r,
    });
  });

  it("uses the checkout top under --separate-git-dir", () => {
    const base = tmpDir("roots-sep-");
    const work = path.join(base, "work");
    execFileSync("git", ["init", "-q", `--separate-git-dir=${path.join(base, "gitdir")}`, work]);
    touch(work, INSTALL_MARKER);
    touch(work, "packages/a/index.js");
    expect(resolveRoots({ cwd: path.join(work, "packages/a") }, { cwd: base, env: noEnv }).root).toBe(work);
  });

  it("uses the submodule's own top inside a submodule", () => {
    const sub = repo("roots-subm-src-", null);
    const r = repo("roots-subm-");
    git(r, "submodule", "add", "-q", sub, "mods/s");
    const s = path.join(r, "mods/s");
    expect(resolveRoots({ cwd: path.join(s, "packages/a") }, { cwd: r, env: noEnv })).toMatchObject({
      checkout: s,
      root: s,
    });
  });
});

describe("resolveRoots", () => {
  it("keeps a repo install in a subpackage on its own root, also from its worktree", () => {
    const r = repo("roots-subpkg-", "apps/web");
    const web = path.join(r, "apps/web");
    fs.mkdirSync(path.join(web, "src"), { recursive: true });
    expect(resolveRoots({ cwd: path.join(web, "src") }, { cwd: r, env: noEnv })).toMatchObject({
      checkout: web,
      root: web,
    });
    git(r, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
    const wWeb = path.join(r, ".worktrees/w/apps/web");
    expect(resolveRoots({ cwd: wWeb }, { cwd: r, env: noEnv })).toMatchObject({ checkout: wWeb, root: web });
  });

  it("resolves a consumer's root from repo.config.ts alone, with no agents dir", () => {
    const r = tmpDir("roots-consumer-");
    git(r, "init", "-q");
    touch(r, "repo.config.ts");
    touch(r, "packages/a/index.js");
    expect(fs.existsSync(path.join(r, "agents"))).toBe(false);
    expect(resolveRoots({ cwd: path.join(r, "packages/a") }, { cwd: r, env: noEnv })).toMatchObject({
      checkout: r,
      root: r,
    });
  });
});

describe("resolveRoots", () => {
  it("keeps a subpackage with its own repo.config.ts on its own root", () => {
    const r = tmpDir("roots-own-config-");
    git(r, "init", "-q");
    touch(r, "repo.config.ts");
    touch(r, "apps/web/repo.config.ts");
    touch(r, "apps/web/src/index.ts");
    const web = path.join(r, "apps/web");
    expect(resolveRoots({ cwd: path.join(web, "src") }, { cwd: r, env: noEnv })).toMatchObject({
      checkout: web,
      root: web,
    });
  });

  it("ignores a foreign agents dir without the repo marker", () => {
    const r = repo("roots-foreign-");
    fs.mkdirSync(path.join(r, "packages/a/agents/rules"), { recursive: true });
    const a = path.join(r, "packages/a");
    expect(resolveRoots({ cwd: a }, { cwd: r, env: noEnv })).toMatchObject({ checkout: r, root: r });
  });
});

describe("resolveRoots", () => {
  it("gives every root the real spelling when the cwd is an alias of the repo", () => {
    const r = repo("roots-alias-");
    const alias = aliasOf(r);
    expect(resolveRoots({ cwd: path.join(alias, "packages/a") }, { cwd: alias, env: noEnv })).toStrictEqual({
      checkout: r,
      cwd: path.join(r, "packages/a"),
      root: r,
    });
    expect(resolveRoots({}, { cwd: alias, env: { CLAUDE_PROJECT_DIR: alias } })).toStrictEqual({
      checkout: r,
      cwd: r,
      root: r,
    });
    expect(canonicalPath(path.join(alias, "missing/x.md"))).toBe(path.join(r, "missing/x.md"));
  });

  it("uses the raw dir outside git", () => {
    const d = tmpDir("roots-nogit-");
    expect(resolveRoots({}, { cwd: d, env: noEnv })).toStrictEqual({ checkout: d, cwd: d, root: d });
  });
});
