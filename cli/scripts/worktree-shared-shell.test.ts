import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { NONE, at, cli, git, scratch, shared, wt } from "./fixtures/worktree-repo.ts";
import { sharedGitReason, worktreeAddReason } from "./worktree-guards.ts";
import type { ShellAt } from "./worktree.types.ts";

const tmp = scratch();
afterEach(() => tmp.cleanup());

function withWorktrees(): string {
  const r = tmp.repo();
  cli(r, ["add", "a"]);
  cli(r, ["add", "b"]);
  return r;
}

const PREFIXED = [
  "rtk git stash",
  "env A=1 git stash",
  "env A=1 B=2 git stash",
  "A=1 rtk git stash",
  "rtk env A=1 git stash",
  "cd packages && /usr/bin/git stash",
];

it("checks a git command behind an rtk or env prefix like the bare one", () => {
  const r = withWorktrees();
  const a = wt(r, "a");
  for (const cmd of PREFIXED) {
    expect(shared(cmd, at(r)), cmd).toMatch(/^git stash in the main checkout /);
    expect(shared(cmd, at(r), new Set(["stash"])), `${cmd} asked`).toBeNull();
    expect(shared(cmd, at(r, a)), `${cmd} in own worktree`).toBeNull();
  }
  expect(shared("rtk git commit -m x", at(r))).toMatch(/^the main checkout is shared/);
  expect(shared("rtk git push --force", at(r, a))).toMatch(/^a force push/);
  expect(shared("env A=1 git -C .worktrees/a reset --hard", at(r))).toBeNull();
  expect(shared("rtk git status", at(r))).toBeNull();
  expect(shared("rtk cargo build", at(r))).toBeNull();
  expect(shared("env A=1 echo git stash", at(r))).toBeNull();
});

it("does not read a heredoc body as commands, but reads what follows it", () => {
  const r = withWorktrees();
  const main = at(r);
  for (const open of ["<<'EOF'", '<<"EOF"', "<<EOF", "<<-EOF", "<< 'EOF'"]) {
    const body = `cat > notes.md ${open}\ngit stash\ngit push --force\ngit worktree add ../x\ngit commit -m x\nEOF`;
    expect(shared(body, main), open).toBeNull();
    expect(worktreeAddReason(body, main), open).toBeNull();
    expect(shared(`${body}\ngit stash`, main), `${open} then stash`).toMatch(/^git stash in the main checkout /);
    expect(shared(`git stash <<'EOF'\nx\nEOF`, main), `${open} command before body`).toMatch(
      /^git stash in the main checkout /,
    );
  }
  expect(shared("cat <<-EOF\n\tgit stash\n\tEOF\ngit commit -m x", main)).toMatch(/^the main checkout is shared/);
  expect(shared("cat <<A <<B\ngit stash\nA\ngit commit -m y\nB\ngit reset --hard", main)).toMatch(
    /^git reset in the main checkout /,
  );
  expect(shared("cat <<'EOF'\ngit stash\nno terminator", main)).toBeNull();
  expect(shared("echo a << 3 && git stash", main)).toMatch(/^git stash in the main checkout /);
});

it("passes outside a git repo and before the first commit", () => {
  const plain = tmp.dir("wt-plain-");
  const unborn = tmp.dir("wt-unborn-");
  git(unborn, "init", "-q", "-b", "main");
  for (const dir of [plain, unborn]) {
    for (const cmd of ["git commit -m x", "git stash", "git push --force", "git branch -D main"])
      expect(shared(cmd, at(dir)), `${dir} ${cmd}`).toBeNull();
  }
});

const WIN_ROOT = at("C:\\r");
const WIN_IN_A = at("C:\\r", "C:\\r\\.worktrees\\a");
const winShared = (cmd: string, place: ShellAt = WIN_ROOT) =>
  sharedGitReason(cmd, { ...place, asked: NONE }, { committed: () => true, p: path.win32 });

it("reads win32 spellings of the root and its worktrees", () => {
  expect(winShared("git commit -m x")).toBe(
    `the main checkout is shared: commit inside C:\\r\\.worktrees\\<name>, then run bun repo worktree finish <name>`,
  );
  expect(winShared("git -C C:/r/packages stash")).toMatch(/^git stash in the main checkout /);
  expect(winShared("git -C 'C:\\r' reset --hard")).toMatch(/^git reset in the main checkout /);
  expect(winShared("git -C c:/R commit -m x")).toMatch(/^the main checkout is shared/);
  expect(winShared("cd .worktrees/a && git stash")).toBeNull();
  expect(winShared("git -C C:/r/.worktrees/a reset --hard")).toBeNull();
  expect(winShared("git -C 'C:\\r\\.worktrees\\a' commit --amend")).toBeNull();
  expect(winShared("git -C c:/R/.worktrees/a stash")).toBeNull();
  expect(winShared("git stash", WIN_IN_A)).toBeNull();
  expect(winShared("git -C C:/r commit -m x", WIN_IN_A)).toMatch(/^the main checkout is shared/);
  expect(winShared("git branch -D wt/b", WIN_IN_A)).toBeNull();
  expect(winShared("git worktree remove 'C:\r.worktrees\b'", WIN_IN_A)).toBeNull();
  expect(winShared("git worktree remove ../b", WIN_IN_A)).toBeNull();
  expect(winShared("git worktree remove 'C:\\r\\.worktrees\\a'", WIN_IN_A)).toBeNull();
  expect(winShared("git push origin +main", WIN_IN_A)).toMatch(/^a force push rewrites shared history/);
  expect(winShared("git -C D:/other stash")).toBeNull();
});

const OFF_PATH_ADDS = [
  "git -C .. worktree add x",
  "cd /tmp && git worktree add w",
  "git worktree add .worktrees/a/b",
  "git worktree add .worktrees/y",
  "git worktree add .worktrees/y -b y",
  "git worktree add --detach .worktrees/y",
];

it("denies worktrees outside .worktrees/<name> on wt/<name>", () => {
  const r = tmp.repo();
  const main = at(r);
  expect(worktreeAddReason("git worktree add ../elsewhere -b spike", main)).toBe(
    `worktrees live in ${path.join(r, ".worktrees", "<name>")} on branch wt/<name>: run bun repo worktree add spike`,
  );
  for (const cmd of OFF_PATH_ADDS) expect(worktreeAddReason(cmd, main), cmd).toMatch(/^worktrees live in /);
  for (const cmd of [
    "git worktree add .worktrees/y -b wt/y",
    // As typed in bash: an unquoted `\` is an escape there, so a Windows path goes in with `/`.
    `git worktree add -b wt/z ${r.split(path.sep).join("/")}/.worktrees/z main`,
    "git worktree add .worktrees/y wt/y",
    "git worktree list",
    "git worktree remove .worktrees/y",
    'git worktree add "$DIR"',
  ])
    expect(worktreeAddReason(cmd, main), cmd).toBeNull();
});

it("reads win32 paths for a worktree add", () => {
  expect(worktreeAddReason("git worktree add 'C:\\r\\.worktrees\\y' -b wt/y", WIN_ROOT, path.win32)).toBeNull();
  expect(worktreeAddReason("git worktree add 'C:\\elsewhere'", WIN_ROOT, path.win32)).toMatch(/^worktrees live in /);
});
