import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { findRoots } from "./find-roots.ts";
import { linkGit } from "./link-git.ts";
import { linkIo } from "./link-io.ts";

const MODULES = "node_modules";
const { tempDir } = useTempDirs("link-root-");
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", ...args], { cwd, encoding: "utf8" });
}

/** A real repo `<base>/repo` with a commit and a worktree `<base>/repo-wt`. */
function checkouts() {
  const base = fs.realpathSync(tempDir());
  const main = path.join(base, "repo");
  fs.mkdirSync(path.join(main, MODULES), { recursive: true });
  git(main, "init", "-q");
  git(main, "commit", "-q", "--allow-empty", "-m", "base");
  const tree = path.join(base, "repo-wt");
  git(main, "worktree", "add", "-q", tree);
  return { base, main, tree };
}

it("finds the main checkout and the siblings from a worktree without its own install", () => {
  const { base, main, tree } = checkouts();
  const roots = findRoots({ ...linkIo(), cwd: tree });
  expect(roots).toStrictEqual({ checkout: tree, install: main, main, siblings: base });
});

it("installs into the worktree once it has its own install", () => {
  const { base, main, tree } = checkouts();
  fs.mkdirSync(path.join(tree, MODULES));
  expect(findRoots({ ...linkIo(), cwd: tree })).toStrictEqual({ checkout: tree, install: tree, main, siblings: base });
});

it("reads git's answer, and null when git fails", () => {
  const { main } = checkouts();
  expect(linkGit(main, ["rev-parse", "--show-toplevel"])).toBe(main);
  expect(linkGit(main, ["rev-parse", "--verify", "refs/heads/nope"])).toBeNull();
});

it("runs bun install and writes lines to the process streams", () => {
  const { base } = checkouts();
  const io = linkIo();
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  io.out("hello");
  io.err("oops");
  expect(stdout).toHaveBeenCalledWith("hello\n");
  expect(stderr).toHaveBeenCalledWith("oops\n");
  fs.writeFileSync(path.join(base, "package.json"), JSON.stringify({ name: "empty" }));
  expect(io.install(base)).toMatchObject({ code: 0, output: expect.stringContaining("bun install") as unknown });
  expect(io.now()).toBeInstanceOf(Date);
});

it("exits 1 for an install that cannot run", () => {
  expect(linkIo().install(path.join(os.tmpdir(), "no-such-dir-for-link"))).toMatchObject({ code: 1 });
});
