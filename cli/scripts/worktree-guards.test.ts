import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { scratch } from "./__fixtures__/worktree-repo.ts";
import {
  gitAskedWords,
  mainCheckoutWriteReason,
  managedLessonsDir,
  sharedGitReason,
  worktreeAddReason,
} from "./worktree-guards.ts";

const tmp = scratch();

afterEach(() => tmp.cleanup());

const DENIED = /^worktrees live in /;

it("reads the flags of git worktree add: a missing -b value, -d, a --reason value, unknown flags, extra words", () => {
  const r = tmp.repo();
  const roots = { checkout: r, cwd: r, root: r };

  function deny(cmd: string) {
    return worktreeAddReason(cmd, { cwd: r, roots });
  }

  expect(deny("git worktree add .worktrees/y -b")).toMatch(DENIED);
  expect(deny("git worktree add -d .worktrees/y")).toMatch(DENIED);
  expect(deny("git worktree add --reason why .worktrees/y wt/y")).toBeNull();
  expect(deny("git worktree add --reason why .worktrees/y")).toMatch(DENIED);
  expect(deny("git worktree add --force .worktrees/y wt/y extra")).toBeNull();
});

it("suggests a name from the branch or the dir, and a placeholder when neither is usable", () => {
  const r = tmp.repo();
  const roots = { checkout: r, cwd: r, root: r };

  function suggested(cmd: string) {
    return worktreeAddReason(cmd, { cwd: r, roots })?.replace(/^.*run /, "");
  }

  expect(suggested("git worktree add ../elsewhere")).toBe("bun repo worktree add elsewhere");
  expect(suggested("git worktree add ../x -b wt/spike")).toBe("bun repo worktree add spike");
  expect(suggested("git worktree add ../x -b ..")).toBe("bun repo worktree add <name>");
});

it("resolves a write target against the root when the roots carry no cwd", () => {
  const r = tmp.repo();
  expect(mainCheckoutWriteReason("packages/a/index.js", { root: r })).toMatch(/^the main checkout is shared: /);
  expect(mainCheckoutWriteReason(".tmp/note.md", { root: r })).toBeNull();
  expect(managedLessonsDir("packages/a/index.js", { root: r })).toBe(path.join(r, ".repo", "lessons"));
  expect(managedLessonsDir(".worktrees/w/src/a.ts", { root: r })).toBe(
    path.join(r, ".worktrees", "w", ".repo", "lessons"),
  );
});

it("guards update-ref on the default branch even behind a -m message, and frees other refs", () => {
  const r = tmp.repo();

  function check(cmd: string) {
    return sharedGitReason(cmd, { asked: new Set(), cwd: r, roots: { cwd: r, root: r } });
  }

  expect(check("git update-ref -m moved refs/heads/main HEAD")).toMatch(/^main is the shared default branch/);
  expect(check("git update-ref -m moved refs/heads/wt/x HEAD")).toBeNull();
  expect(check("git update-ref -m moved")).toBeNull();
});

it("finds no grant words in no prompt", () => {
  expect(gitAskedWords(undefined)).toStrictEqual([]);
  expect(gitAskedWords(null)).toStrictEqual([]);
  expect(gitAskedWords("please git commit and git stash")).toStrictEqual(["commit", "stash"]);
});
