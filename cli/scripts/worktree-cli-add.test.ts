import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { cli, commitIn, git, scratch, write, wt } from "./fixtures/worktree-repo.ts";

const tmp = scratch();
afterEach(() => tmp.cleanup());

it("makes .worktrees/<name> on wt/<name> from any start, once", () => {
  const r = tmp.repo();
  const first = cli(path.join(r, "packages/a"), ["add", "auth"]);
  expect(first.status, first.stderr).toBe(0);
  expect(first.stdout).toBe(`${wt(r, "auth")}\n`);
  expect(git(wt(r, "auth"), "branch", "--show-current")).toBe("wt/auth");
  expect(git(wt(r, "auth"), "rev-parse", "HEAD")).toBe(git(r, "rev-parse", "HEAD"));
  expect(cli(r, ["add", "auth"]).stdout).toBe(`${wt(r, "auth")}\n`);
  expect(git(r, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(2);
  expect(cli(wt(r, "auth"), ["add", "b"]).stdout).toBe(`${wt(r, "b")}\n`);
  const away = tmp.dir("wt-away-");
  expect(cli(away, ["add", "e"], { env: { CLAUDE_PROJECT_DIR: path.join(r, "packages/a") } }).stdout).toBe(
    `${wt(r, "e")}\n`,
  );
});

it("copies missing gitignored .worktreeinclude matches and never overwrites", () => {
  const r = tmp.repo();
  write(path.join(r, ".worktreeinclude"), ".env\nnotes.txt\ntracked.cfg\n");
  write(path.join(r, "tracked.cfg"), "tracked\n");
  git(r, "add", "-A");
  git(r, "commit", "-qm", "include");
  write(path.join(r, ".env"), "SECRET=1\n");
  write(path.join(r, "notes.txt"), "loose\n");
  expect(cli(r, ["add", "inc"]).status).toBe(0);
  const w = wt(r, "inc");
  expect(fs.readFileSync(path.join(w, ".env"), "utf8")).toBe("SECRET=1\n");
  expect(fs.existsSync(path.join(w, "notes.txt"))).toBe(false);
  expect(fs.readFileSync(path.join(w, "tracked.cfg"), "utf8")).toBe("tracked\n");
  fs.rmSync(path.join(w, ".env"));
  cli(r, ["add", "inc"]);
  expect(fs.readFileSync(path.join(w, ".env"), "utf8")).toBe("SECRET=1\n");
  write(path.join(w, ".env"), "LOCAL=1\n");
  cli(r, ["add", "inc"]);
  expect(fs.readFileSync(path.join(w, ".env"), "utf8")).toBe("LOCAL=1\n");
});

it("cleans names, refuses unusable ones and foreign dirs, and attaches an existing wt/<name>", () => {
  const r = tmp.repo();
  expect(cli(r, ["add", "feature/x y"]).stdout).toBe(`${wt(r, "feature-x-y")}\n`);
  const dots = cli(r, ["add", ".."]);
  expect(dots.status).toBe(1);
  expect(dots.stdout).toBe("");
  expect(dots.stderr).toContain(`worktree name ".." has no usable characters; use letters, digits, ".", "_" or "-"`);
  write(path.join(wt(r, "c"), "keep.txt"), "mine\n");
  const busy = cli(r, ["add", "c"]);
  expect(busy.status).toBe(1);
  expect(busy.stderr).toContain(
    `${wt(r, "c")} exists and is not a worktree of this repo; move it or pick another name`,
  );
  expect(fs.readFileSync(path.join(wt(r, "c"), "keep.txt"), "utf8")).toBe("mine\n");
  git(r, "switch", "-q", "-c", "wt/d");
  commitIn(r, "d.txt");
  git(r, "switch", "-q", "main");
  const tip = git(r, "rev-parse", "wt/d");
  expect(cli(r, ["add", "d"]).status).toBe(0);
  expect(git(wt(r, "d"), "rev-parse", "HEAD")).toBe(tip);
});
