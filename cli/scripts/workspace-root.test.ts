import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import { canonicalPath, INSTALL_MARKER, resolveRoots } from "./workspace-root.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) for (const x of [d, `${d}-alias`]) fs.rmSync(x, { force: true, recursive: true });
});

function tmpDir(prefix: string) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}

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

  it("resolves a consumer's root from workerstack.config.ts alone, with no agents dir", () => {
    const r = tmpDir("roots-consumer-");
    git(r, "init", "-q");
    touch(r, "workerstack.config.ts");
    touch(r, "packages/a/index.js");
    expect(fs.existsSync(path.join(r, "agents"))).toBe(false);
    expect(resolveRoots({ cwd: path.join(r, "packages/a") }, { cwd: r, env: noEnv })).toMatchObject({
      checkout: r,
      root: r,
    });
  });

  it("keeps a subpackage with its own workerstack.config.ts on its own root", () => {
    const r = tmpDir("roots-own-config-");
    git(r, "init", "-q");
    touch(r, "workerstack.config.ts");
    touch(r, "apps/web/workerstack.config.ts");
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

  it("takes the first set candidate in D1 order", () => {
    const dirs = Array.from({ length: 7 }, (_, i) => tmpDir(`roots-order-${i}-`));
    const [ws, paths, grok, claude, cwd, agCwd, proc] = dirs as [
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
    const rootOf = (i: object, e: Partial<typeof env>) => resolveRoots(i, { cwd: proc, env: e }).root;
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
