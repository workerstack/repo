import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import { git, scratch, wt } from "./fixtures/worktree-repo.ts";
import { gitAskedWords, mainCheckoutWriteReason, managedLessonsDir } from "./worktree-guards.ts";

const tmp = scratch();
afterEach(() => tmp.cleanup());

const rootsOf = (r: string) => ({ checkout: r, cwd: r, root: r });
const WIN_ROOTS = rootsOf("C:\\r");

it("denies a write into the main checkout and frees .tmp, worktrees and anything outside", () => {
  const r = tmp.repo();
  const roots = rootsOf(r);
  const reason = `the main checkout is shared: run bun repo worktree add <name> and write under ${path.join(r, ".worktrees", "<name>")}; only ${path.join(r, ".tmp")}${path.sep} is writable here`;
  expect(mainCheckoutWriteReason(path.join(r, "src/x.ts"), roots)).toBe(reason);
  expect(mainCheckoutWriteReason(path.join(r, ".repo/lessons/l.md"), roots)).toBe(reason);
  expect(mainCheckoutWriteReason("src/x.ts", roots)).toBe(reason);
  expect(mainCheckoutWriteReason(path.join(aliasOf(r), "src/x.ts"), roots)).toBe(reason);
  for (const free of [".tmp/repo/n.md", ".tmp", ".worktrees/a/src/x.ts", ".worktrees/a"])
    expect(mainCheckoutWriteReason(path.join(r, free), roots), free).toBeNull();

  expect(mainCheckoutWriteReason(path.join(tmp.dir("wt-out-"), "x.ts"), roots)).toBeNull();
});

it("lets any write through outside a git repo and before the first commit", () => {
  const plain = tmp.dir("wt-plain-");
  const unborn = tmp.dir("wt-unborn-");
  git(unborn, "init", "-q", "-b", "main");
  for (const dir of [plain, unborn])
    expect(mainCheckoutWriteReason(path.join(dir, "src/x.ts"), rootsOf(dir))).toBeNull();
});

it("reads win32 spellings of a write", () => {
  const check = (target: string) =>
    mainCheckoutWriteReason(target, WIN_ROOTS, { committed: () => true, p: path.win32 });
  expect(check("C:\\r\\src\\x.ts")).toBe(
    "the main checkout is shared: run bun repo worktree add <name> and write under C:\\r\\.worktrees\\<name>; only C:\\r\\.tmp\\ is writable here",
  );
  expect(check("c:/R/src/x.ts")).toMatch(/^the main checkout is shared/);
  expect(check("src\\x.ts")).toMatch(/^the main checkout is shared/);
  for (const free of ["C:\\r\\.tmp\\repo\\n.md", "C:/r/.worktrees/a/src/x.ts", "D:\\other\\x.ts", "C:\\rr\\x.ts"])
    expect(check(free), free).toBeNull();
});

const GIT_PREFIXED = ["switch", "restore", "clean", "reset", "merge", "pull", "revert", "am", "branch", "update-ref"];
const FORCE_PHRASES = ["force push it", "do a force-push", "git push -f please", "git push --force"];

it("finds whole words the user named, and nothing from everyday phrases", () => {
  expect(gitAskedWords("stash the main checkout")).toStrictEqual(["stash"]);
  expect(gitAskedWords("STASH it")).toStrictEqual(["stash"]);
  expect(gitAskedWords("I stashed it already")).toStrictEqual([]);
  expect(gitAskedWords("git checkout main")).toStrictEqual(["checkout"]);
  expect(gitAskedWords("clean up the code")).toStrictEqual([]);
  expect(gitAskedWords("merge to main and switch to the main checkout")).toStrictEqual([]);
  expect(gitAskedWords("/commit")).toStrictEqual(["commit"]);
  expect(gitAskedWords("committed and pulled")).toStrictEqual([]);
  expect(gitAskedWords("rebase onto main, then cherry-pick abc")).toStrictEqual(
    expect.arrayContaining(["rebase", "cherry-pick"]),
  );
  expect(gitAskedWords("rebase onto main, then cherry-pick abc")).toHaveLength(2);
  for (const sub of GIT_PREFIXED) expect(gitAskedWords(`please run git ${sub} now`), sub).toStrictEqual([sub]);
  for (const phrase of FORCE_PHRASES) expect(gitAskedWords(phrase), phrase).toContain("force");
  expect(gitAskedWords("push it to origin")).toStrictEqual([]);
  expect(gitAskedWords("")).toStrictEqual([]);
});

it("names the lessons dir of the root or the managed worktree that holds the file", () => {
  const r = tmp.repo();
  const roots = rootsOf(r);
  const lessons = (dir: string) => path.join(dir, ".repo", "lessons");
  expect(managedLessonsDir(path.join(r, "src/x.ts"), roots)).toBe(lessons(r));
  expect(managedLessonsDir(path.join(r, ".repo/lessons/l.md"), roots)).toBe(lessons(r));
  expect(managedLessonsDir(path.join(r, ".worktrees/a/src/x.ts"), roots)).toBe(lessons(wt(r, "a")));
  expect(managedLessonsDir(path.join(r, ".worktrees/a/.repo/lessons/l.md"), roots)).toBe(lessons(wt(r, "a")));
  expect(managedLessonsDir(path.join(aliasOf(r), "src/x.ts"), roots)).toBe(lessons(r));
  expect(managedLessonsDir(path.join(aliasOf(r), ".worktrees/a/x.ts"), roots)).toBe(lessons(wt(r, "a")));
  expect(managedLessonsDir("src/x.ts", roots)).toBe(lessons(r));
  expect(managedLessonsDir(path.join(tmp.dir("wt-out-"), "x.ts"), roots)).toBeNull();
  expect(managedLessonsDir(`${r}-sibling/x.ts`, roots)).toBeNull();
});

it("reads win32 spellings of a lessons dir", () => {
  expect(managedLessonsDir("C:\\r\\src\\x.ts", WIN_ROOTS, path.win32)).toBe("C:\\r\\.repo\\lessons");
  expect(managedLessonsDir("c:/R/.worktrees/a/src/x.ts", WIN_ROOTS, path.win32)).toBe(
    "C:\\r\\.worktrees\\a\\.repo\\lessons",
  );
  expect(managedLessonsDir("D:\\r\\x.ts", WIN_ROOTS, path.win32)).toBeNull();
  expect(managedLessonsDir("C:\\rr\\x.ts", WIN_ROOTS, path.win32)).toBeNull();
});
