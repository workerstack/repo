import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { captured, commitIn, git, hasBranch, scratch, write, wt } from "./fixtures/worktree-repo.ts";
import { addWorktree, worktreeName } from "./worktree.ts";

const tmp = scratch();
afterEach(() => tmp.cleanup());

it("makes .worktrees/<name> on wt/<name> from HEAD, then reuses it", () => {
  const r = tmp.repo();
  expect(addWorktree(r, "auth")).toEqual({ path: wt(r, "auth"), branch: "wt/auth", created: true });
  expect(git(wt(r, "auth"), "branch", "--show-current")).toBe("wt/auth");
  expect(git(wt(r, "auth"), "rev-parse", "HEAD")).toBe(git(r, "rev-parse", "HEAD"));
  expect(addWorktree(r, "auth")).toEqual({ path: wt(r, "auth"), branch: "wt/auth", created: false });
  expect(git(r, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(2);
});

it("cleans a name into a git-safe one and refuses a name with nothing usable", () => {
  const r = tmp.repo();
  expect(addWorktree(r, "feature/x y").path).toBe(wt(r, "feature-x-y"));
  expect(worktreeName("--.a..b--")).toBe("a..b");
  expect(worktreeName(null)).toBeNull();
  expect(worktreeName(undefined)).toBeNull();
  for (const raw of ["..", "", undefined]) {
    expect(() => addWorktree(r, raw)).toThrow(/has no usable characters; use letters, digits/);
  }
  expect(() => addWorktree(r, "..")).toThrow('worktree name ".." has no usable');
});

it("refuses a dir that is not a worktree of this repo and leaves its files alone", () => {
  const r = tmp.repo();
  write(path.join(wt(r, "c"), "keep.txt"), "mine\n");
  expect(() => addWorktree(r, "c")).toThrow(
    `${wt(r, "c")} exists and is not a worktree of this repo; move it or pick another name`,
  );
  expect(fs.readFileSync(path.join(wt(r, "c"), "keep.txt"), "utf8")).toBe("mine\n");
});

it("attaches an existing wt/<name> branch at its own tip", () => {
  const r = tmp.repo();
  git(r, "switch", "-q", "-c", "wt/d");
  commitIn(r, "d.txt");
  git(r, "switch", "-q", "main");
  expect(addWorktree(r, "d").created).toBe(true);
  expect(git(wt(r, "d"), "rev-parse", "HEAD")).toBe(git(r, "rev-parse", "wt/d"));
});

it("says so when git cannot make the worktree", () => {
  const r = tmp.repo();
  git(r, "switch", "-q", "-c", "wt/busy");
  expect(() => addWorktree(r, "busy")).toThrow(`git worktree add failed for ${wt(r, "busy")}`);
  expect(fs.existsSync(wt(r, "busy"))).toBe(false);
});

it("remakes a worktree whose dir was deleted behind git's back", () => {
  const r = tmp.repo();
  addWorktree(r, "gone");
  fs.rmSync(wt(r, "gone"), { recursive: true });
  expect(addWorktree(r, "gone")).toEqual({ path: wt(r, "gone"), branch: "wt/gone", created: true });
  expect(fs.existsSync(path.join(wt(r, "gone"), "packages/a/index.js"))).toBe(true);
  expect(hasBranch(r, "wt/gone")).toBe(true);
});

it("copies ignored files .worktreeinclude names that the worktree lacks, and never overwrites", () => {
  const r = tmp.repo();
  write(path.join(r, ".gitignore"), ".env\n.worktrees/\nconfig/*.local\n");
  write(path.join(r, ".worktreeinclude"), ".env\nnotes.txt\n*.local\n*.txt\n");
  git(r, "add", "-A");
  git(r, "commit", "-qm", "include");
  write(path.join(r, ".env"), "SECRET=1\n");
  write(path.join(r, "config/db.local"), "db\n");
  write(path.join(r, "notes.txt"), "loose\n");
  write(path.join(r, ".worktrees/stray/n.txt"), "stray\n");
  addWorktree(r, "inc");
  const w = wt(r, "inc");
  expect(fs.readFileSync(path.join(w, ".env"), "utf8")).toBe("SECRET=1\n");
  expect(fs.readFileSync(path.join(w, "config/db.local"), "utf8")).toBe("db\n");
  expect(fs.existsSync(path.join(w, "notes.txt"))).toBe(false);
  expect(fs.existsSync(path.join(w, ".worktrees"))).toBe(false);
  fs.rmSync(path.join(w, ".env"));
  write(path.join(w, "config/db.local"), "mine\n");
  addWorktree(r, "inc");
  expect(fs.readFileSync(path.join(w, ".env"), "utf8")).toBe("SECRET=1\n");
  expect(fs.readFileSync(path.join(w, "config/db.local"), "utf8")).toBe("mine\n");
});

it("makes the worktree when .worktreeinclude names nothing present", () => {
  const r = tmp.repo();
  write(path.join(r, ".worktreeinclude"), ".env\nnotes.txt\n");
  write(path.join(r, "notes.txt"), "loose, not ignored\n");
  expect(addWorktree(r, "plain").created).toBe(true);
  expect(fs.readdirSync(wt(r, "plain")).sort()).toEqual([".git", ".gitignore", "packages"]);
});

it("warns on stderr and still returns the path when the install fails", () => {
  const r = tmp.repo();
  write(path.join(r, "bun.lockb"), "not a real binary lockfile");
  git(r, "add", "-A");
  git(r, "commit", "-qm", "legacy lockfile");
  const made = captured(() => addWorktree(r, "old"));
  expect(made.value.path).toBe(wt(r, "old"));
  expect(made.stderr).toBe(
    `could not install dependencies in ${wt(r, "old")}: run bun install --frozen-lockfile there\n`,
  );
});

it("installs from the lockfile in a new worktree only, and says nothing when it works", () => {
  const r = tmp.repo();
  const mark = `node -e "require('fs').writeFileSync('installed.marker','1')"`;
  const pkg = {
    name: "f",
    version: "1.0.0",
    scripts: { postinstall: mark },
    dependencies: { dep: "file:./vendor/dep" },
  };
  write(path.join(r, "vendor/dep/package.json"), `${JSON.stringify({ name: "dep", version: "1.0.0" })}\n`);
  write(path.join(r, "package.json"), `${JSON.stringify(pkg)}\n`);
  write(path.join(r, ".gitignore"), ".worktrees/\nnode_modules/\ninstalled.marker\n");
  execFileSync("bun", ["install"], { cwd: r, stdio: "ignore" });
  git(r, "add", "-A");
  git(r, "commit", "-qm", "bun");
  const made = captured(() => addWorktree(r, "fresh"));
  expect(made.stderr).toBe("");
  expect(fs.existsSync(path.join(wt(r, "fresh"), "installed.marker"))).toBe(true);
  fs.rmSync(path.join(wt(r, "fresh"), "installed.marker"));
  addWorktree(r, "fresh");
  expect(fs.existsSync(path.join(wt(r, "fresh"), "installed.marker"))).toBe(false);
});

it("makes the worktree when .worktreeinclude matches no file at all", () => {
  const r = tmp.repo();
  write(path.join(r, ".worktreeinclude"), ".env\n");
  expect(addWorktree(r, "bare").created).toBe(true);
  expect(fs.existsSync(path.join(wt(r, "bare"), ".env"))).toBe(false);
});
