import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aliasOf } from "../../dev/test-paths";
import { canonicalPath, GRUNT_MARKER, resolveRoots } from "./workspace-root.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) for (const x of [d, `${d}-alias`]) fs.rmSync(x, { recursive: true, force: true });
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

/** A committed repo with the grunt marker at `markerAt` (relative; null for none) and `packages/a/`. */
function repo(prefix: string, markerAt: string | null = "") {
  const root = tmpDir(prefix);
  git(root, "init", "-q");
  if (markerAt !== null) touch(root, path.join(markerAt, GRUNT_MARKER));
  touch(root, "packages/a/index.js");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}

const noEnv = {};

describe("resolveRoots", () => {
  it("gives the repo top for every root at the top of a plain repo", () => {
    const r = repo("roots-plain-");
    expect(resolveRoots({}, { env: noEnv, cwd: r })).toEqual({ root: r, checkout: r, cwd: r });
  });

  it("keeps root and checkout at the top from a subdir, and cwd in the subdir", () => {
    const r = repo("roots-sub-");
    const a = path.join(r, "packages/a");
    expect(resolveRoots({ cwd: a }, { env: noEnv, cwd: r })).toEqual({ root: r, checkout: r, cwd: a });
    expect(resolveRoots({}, { env: { CLAUDE_PROJECT_DIR: a }, cwd: a }).root).toBe(r);
  });

  it("puts root at the main checkout and checkout in a linked worktree", () => {
    const r = repo("roots-wt-");
    git(r, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
    const w = path.join(r, ".worktrees/w");
    expect(resolveRoots({ cwd: path.join(w, "packages/a") }, { env: noEnv, cwd: r })).toEqual({
      root: r,
      checkout: w,
      cwd: path.join(w, "packages/a"),
    });
  });

  it("after EnterWorktree, takes root from the project dir and checkout from the hook cwd", () => {
    const r = repo("roots-enter-");
    git(r, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
    const w = path.join(r, ".worktrees/w");
    expect(resolveRoots({ cwd: w }, { env: { CLAUDE_PROJECT_DIR: r }, cwd: r })).toEqual({ root: r, checkout: w, cwd: w });
  });

  it("uses the checkout top under --separate-git-dir", () => {
    const base = tmpDir("roots-sep-");
    const work = path.join(base, "work");
    execFileSync("git", ["init", "-q", `--separate-git-dir=${path.join(base, "gitdir")}`, work]);
    touch(work, GRUNT_MARKER);
    touch(work, "packages/a/index.js");
    expect(resolveRoots({ cwd: path.join(work, "packages/a") }, { env: noEnv, cwd: base }).root).toBe(work);
  });

  it("uses the submodule's own top inside a submodule", () => {
    const sub = repo("roots-subm-src-", null);
    const r = repo("roots-subm-");
    git(r, "submodule", "add", "-q", sub, "mods/s");
    const s = path.join(r, "mods/s");
    expect(resolveRoots({ cwd: path.join(s, "packages/a") }, { env: noEnv, cwd: r })).toMatchObject({ root: s, checkout: s });
  });

  it("keeps a grunt install in a subpackage on its own root, also from its worktree", () => {
    const r = repo("roots-subpkg-", "apps/web");
    const web = path.join(r, "apps/web");
    fs.mkdirSync(path.join(web, "src"), { recursive: true });
    expect(resolveRoots({ cwd: path.join(web, "src") }, { env: noEnv, cwd: r })).toMatchObject({ root: web, checkout: web });
    git(r, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
    const wWeb = path.join(r, ".worktrees/w/apps/web");
    expect(resolveRoots({ cwd: wWeb }, { env: noEnv, cwd: r })).toMatchObject({ root: web, checkout: wWeb });
  });

  it("ignores a foreign .rulesync dir without the grunt marker", () => {
    const r = repo("roots-foreign-");
    fs.mkdirSync(path.join(r, "packages/a/.rulesync/rules"), { recursive: true });
    const a = path.join(r, "packages/a");
    expect(resolveRoots({ cwd: a }, { env: noEnv, cwd: r })).toMatchObject({ root: r, checkout: r });
  });

  it("gives every root the real spelling when the cwd is an alias of the repo", () => {
    const r = repo("roots-alias-");
    const alias = aliasOf(r);
    expect(resolveRoots({ cwd: path.join(alias, "packages/a") }, { env: noEnv, cwd: alias })).toEqual({
      root: r,
      checkout: r,
      cwd: path.join(r, "packages/a"),
    });
    expect(resolveRoots({}, { env: { CLAUDE_PROJECT_DIR: alias }, cwd: alias })).toEqual({ root: r, checkout: r, cwd: r });
    expect(canonicalPath(path.join(alias, "missing/x.md"))).toBe(path.join(r, "missing/x.md"));
  });

  it("uses the raw dir outside git", () => {
    const d = tmpDir("roots-nogit-");
    expect(resolveRoots({}, { env: noEnv, cwd: d })).toEqual({ root: d, checkout: d, cwd: d });
  });

  it("takes the first set candidate in D1 order", () => {
    const dirs = Array.from({ length: 8 }, (_, i) => tmpDir(`roots-order-${i}-`));
    const [ws, paths, grok, gemini, claude, cwd, agCwd, proc] = dirs;
    const input = { workspaceRoot: ws, workspacePaths: [paths], cwd, toolCall: { args: { Cwd: agCwd } } };
    const env = { GROK_WORKSPACE_ROOT: grok, GEMINI_PROJECT_DIR: gemini, CLAUDE_PROJECT_DIR: claude };
    const rootOf = (i: object, e: object) => resolveRoots(i, { env: e, cwd: proc }).root;
    expect(rootOf(input, env)).toBe(ws);
    expect(rootOf({ ...input, workspaceRoot: undefined, workspace_root: ws }, env)).toBe(ws);
    expect(rootOf({ ...input, workspaceRoot: undefined }, env)).toBe(paths);
    expect(rootOf({ ...input, workspaceRoot: undefined, workspacePaths: [`file://${paths}`] }, env)).toBe(paths);
    expect(rootOf({ cwd, toolCall: input.toolCall }, env)).toBe(grok);
    expect(rootOf({ cwd }, { GEMINI_PROJECT_DIR: gemini, CLAUDE_PROJECT_DIR: claude })).toBe(gemini);
    expect(rootOf({ cwd }, { CLAUDE_PROJECT_DIR: claude })).toBe(claude);
    expect(rootOf({ cwd, toolCall: input.toolCall }, {})).toBe(cwd);
    expect(rootOf({ toolCall: input.toolCall }, {})).toBe(agCwd);
    expect(rootOf({}, {})).toBe(proc);
    expect(resolveRoots({ toolCall: input.toolCall }, { env: {}, cwd: proc }).cwd).toBe(agCwd);
  });

  it("maps Windows git output with path.win32", () => {
    const facts: Record<string, { top: string; gitDir: string; commonDir: string }> = {
      "C:\\r\\.worktrees\\w\\src": { top: "C:/r/.worktrees/w", gitDir: "C:/r/.git/worktrees/w", commonDir: "C:/r/.git" },
      "C:\\r\\src": { top: "C:/r", gitDir: "C:/r/.git", commonDir: "C:/r/.git" },
    };
    const opts = {
      env: {},
      cwd: "C:\\r",
      p: path.win32,
      git: (dir: string) => facts[dir] ?? null,
      exists: (abs: string) => abs === path.win32.join("C:\\r", GRUNT_MARKER) || abs === path.win32.join("C:\\r\\.worktrees\\w", GRUNT_MARKER),
      realpath: (abs: string) => abs,
    };
    expect(resolveRoots({ cwd: "C:\\r\\.worktrees\\w\\src" }, opts)).toEqual({
      root: "C:\\r",
      checkout: "C:\\r\\.worktrees\\w",
      cwd: "C:\\r\\.worktrees\\w\\src",
    });
    expect(resolveRoots({ cwd: "C:\\r\\src" }, opts).root).toBe("C:\\r");
  });
});
