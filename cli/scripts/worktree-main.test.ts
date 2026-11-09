import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { commitIn, git, hasBranch, mainIn, scratch, write, wt } from "./fixtures/worktree-repo.ts";

const tmp = scratch();
afterEach(() => tmp.cleanup());

const USAGE = "usage: bun repo worktree add <name> | finish [<name>] | list | prune | hook\n";

it("prints usage and exits 2 for no command, an unknown one, or add without a name", () => {
  const r = tmp.repo();
  for (const args of [[], ["nope"], ["add"]]) {
    expect(mainIn(r, args), args.join(" ")).toEqual({ code: 2, stdout: "", stderr: USAGE });
  }
});

it("adds a worktree and prints its path, or the reason it could not", () => {
  const r = tmp.repo();
  expect(mainIn(path.join(r, "packages/a"), ["add", "auth"])).toEqual({
    code: 0,
    stdout: `${wt(r, "auth")}\n`,
    stderr: "",
  });
  const bad = mainIn(r, ["add", ".."]);
  expect([bad.code, bad.stdout]).toEqual([1, ""]);
  expect(bad.stderr).toBe('worktree name ".." has no usable characters; use letters, digits, ".", "_" or "-"\n');
});

it("finish lands the work and says where the shell may still be", () => {
  const r = tmp.repo();
  mainIn(r, ["add", "a"]);
  commitIn(wt(r, "a"), "a.txt");
  const sha = git(wt(r, "a"), "rev-parse", "--short", "HEAD");
  expect(mainIn(r, ["finish", "a"])).toEqual({
    code: 0,
    stdout: `merged wt/a into main at ${sha} and removed ${wt(r, "a")}; your shell may still be in it: cd ${r}\n`,
    stderr: "",
  });
  expect(hasBranch(r, "wt/a")).toBe(false);
});

it("finish says when the branch had no commits of its own", () => {
  const r = tmp.repo();
  mainIn(r, ["add", "empty"]);
  expect(mainIn(r, ["finish", "empty"]).stdout).toBe(`wt/empty has no commits of its own; removed ${wt(r, "empty")}\n`);
});

it("finish exits 2 for no name in the root, 1 for any other failure, and takes the name from inside a worktree", () => {
  const r = tmp.repo();
  mainIn(r, ["add", "n"]);
  commitIn(wt(r, "n"), "n.txt");
  expect(mainIn(r, ["finish"])).toEqual({
    code: 2,
    stdout: "",
    stderr: "run finish inside .worktrees/<name> or pass its name\n",
  });
  expect(mainIn(r, ["finish", "nosuch"])).toEqual({
    code: 1,
    stdout: "",
    stderr: "no worktree or branch named nosuch: bun repo worktree list shows them\n",
  });
  expect(mainIn(path.join(wt(r, "n"), "packages/a"), ["finish"]).stdout).toContain("merged wt/n into main at ");
  expect(fs.existsSync(wt(r, "n"))).toBe(false);
});

it("lists each linked worktree as tab-separated columns, marking those outside .worktrees", () => {
  const r = tmp.repo();
  mainIn(r, ["add", "auth"]);
  mainIn(r, ["add", "done"]);
  commitIn(wt(r, "done"), "d.txt");
  git(r, "merge", "-q", "--no-edit", "wt/done");
  const outside = `${r}-outside`;
  git(r, "worktree", "add", "-q", "--detach", outside);
  write(path.join(outside, "x.txt"), "x");
  const lines = mainIn(r, ["list"]).stdout.trim().split("\n");
  expect(lines.sort()).toEqual(
    [
      `${wt(r, "auth")}\twt/auth\tclean\tunmerged`,
      `${wt(r, "done")}\twt/done\tclean\tmerged`,
      `${outside}\t(detached)\tdirty\tunmerged\toutside .worktrees`,
    ].sort(),
  );
});

it("prune reports each removal, each deleted branch, and when there was nothing", () => {
  const r = tmp.repo();
  expect(mainIn(r, ["prune"]).stdout).toBe("nothing to prune\n");
  mainIn(r, ["add", "m"]);
  commitIn(wt(r, "m"), "m.txt");
  git(r, "merge", "-q", "--no-edit", "wt/m");
  git(r, "branch", "wt/o", "main");
  expect(mainIn(r, ["prune"])).toEqual({
    code: 0,
    stdout: `removed ${wt(r, "m")} (wt/m)\ndeleted branch wt/o\n`,
    stderr: "",
  });
});
