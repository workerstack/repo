import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { markHooksExecutable } from "./standards.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
/** What the user's own `git add -A` does to the temp repo. */
const stageAll = (root: string) => git(root, "add", "-A");

/** A repo like a Windows checkout: git cannot see file modes, so a new file is added as 100644. */
function windowsLikeRepo(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hooks-mode-")));
  dirs.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "core.fileMode", "false");
  fs.mkdirSync(path.join(root, ".githooks"));
  for (const name of ["commit-msg", "pre-commit"]) fs.writeFileSync(path.join(root, ".githooks", name), "#!/bin/sh\n");
  return root;
}

const modes = (root: string) => git(root, "ls-files", "-s", ".githooks").replaceAll(/ \w+ 0/g, "");

it("on win32 marks the hooks 100755 in the index, and a later git add -A keeps it", () => {
  const root = windowsLikeRepo();
  const result = markHooksExecutable(root, "win32");
  expect(result.warnings).toEqual([]);
  expect(result.done).toHaveLength(1);
  stageAll(root);
  expect(modes(root)).toBe("100755\t.githooks/commit-msg\n100755\t.githooks/pre-commit\n");
  expect(markHooksExecutable(root, "win32")).toEqual({ done: [], warnings: [] });
});

it("on win32 fixes a hook already tracked as 100644 without restaging its content", () => {
  const root = windowsLikeRepo();
  stageAll(root);
  expect(modes(root)).toBe("100644\t.githooks/commit-msg\n100644\t.githooks/pre-commit\n");
  fs.writeFileSync(path.join(root, ".githooks", "pre-commit"), "#!/bin/sh\nedited\n");
  markHooksExecutable(root, "win32");
  expect(modes(root)).toBe("100755\t.githooks/commit-msg\n100755\t.githooks/pre-commit\n");
  expect(git(root, "diff", "--name-only")).toBe(".githooks/pre-commit\n");
});

it("does nothing off win32", () => {
  const root = windowsLikeRepo();
  expect(markHooksExecutable(root, "linux")).toEqual({ done: [], warnings: [] });
  expect(git(root, "ls-files", ".githooks")).toBe("");
});

type Reply = { status: number | null; stdout: string; stderr: string };
const reply = (status: number | null, stdout = "", stderr = ""): Reply => ({ status, stdout, stderr });

/** A git runner answering `answers` by the first argument, recording each call's arguments. */
function fakeGit(root: string, answers: Record<string, Reply>) {
  const calls: string[][] = [];
  const run = (_cwd: string, args: readonly string[]): Reply => {
    calls.push([...args]);
    return answers[args[0] ?? ""] ?? reply(0, `${root}\n`);
  };
  return { run, calls };
}

it("does nothing when git cannot name the top level, names another one, or cannot list the hooks", () => {
  const root = windowsLikeRepo();
  const broken = fakeGit(root, { "rev-parse": reply(128, "", "not a repo") });
  expect(markHooksExecutable(root, "win32", broken.run)).toEqual({ done: [], warnings: [] });
  const elsewhere = fakeGit(root, { "rev-parse": reply(0, `${os.tmpdir()}\n`) });
  expect(markHooksExecutable(root, "win32", elsewhere.run)).toEqual({ done: [], warnings: [] });
  const unlisted = fakeGit(root, { "ls-files": reply(1) });
  expect(markHooksExecutable(root, "win32", unlisted.run)).toEqual({ done: [], warnings: [] });
  expect(unlisted.calls.some((args) => args[0] === "update-index")).toBe(false);
});

it("stages a hook the index lacks with --add, one it holds by its staged blob, and skips a missing file", () => {
  const root = windowsLikeRepo();
  fs.rmSync(path.join(root, ".githooks", "pre-commit"));
  const fake = fakeGit(root, { "ls-files": reply(0, "garbage\n100644 abc123 0\t.githooks/other\n") });
  const first = markHooksExecutable(root, "win32", fake.run);
  expect(first.done).toEqual(["marked .githooks/commit-msg executable in the index"]);
  expect(fake.calls.at(-1)).toEqual(["update-index", "--add", "--chmod=+x", "--", ".githooks/commit-msg"]);
  const tracked = fakeGit(root, { "ls-files": reply(0, "100644 abc123 0\t.githooks/commit-msg\n") });
  markHooksExecutable(root, "win32", tracked.run);
  expect(tracked.calls.at(-1)).toEqual(["update-index", "--cacheinfo", "100755,abc123,.githooks/commit-msg"]);
});

it("warns with git's reason when it cannot mark a hook", () => {
  const root = windowsLikeRepo();
  const fake = fakeGit(root, { "update-index": reply(128, "", "index.lock exists\n") });
  expect(markHooksExecutable(root, "win32", fake.run)).toEqual({
    done: [],
    warnings: ["cannot mark the git hooks executable: index.lock exists"],
  });
});
