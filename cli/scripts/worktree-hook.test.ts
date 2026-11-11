import fs from "node:fs";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { commitIn, git, hasBranch, scratch, wt } from "./fixtures/worktree-repo.ts";
import type { HookInput } from "./hook-input.ts";
import { addWorktree } from "./worktree-lifecycle.ts";
import { worktreeHook } from "./worktree.ts";

const tmp = scratch();
beforeEach(() => {
  for (const k of ["GROK_WORKSPACE_ROOT", "CLAUDE_PROJECT_DIR"]) vi.stubEnv(k, undefined);
});
afterEach(() => tmp.cleanup());

const ok = { code: 0, stderr: "", stdout: "" };
function remove(r: string, name: string): HookInput {
  return {
    cwd: r,
    hook_event_name: "WorktreeRemove",
    worktree_path: wt(r, name),
  };
}

it("does nothing for no payload, another event, or a removal that names no path", () => {
  const r = tmp.repo();
  expect(worktreeHook(null)).toStrictEqual(ok);
  expect(worktreeHook({ cwd: r, hook_event_name: "SessionStart" })).toStrictEqual(ok);
  expect(worktreeHook({ cwd: r, hook_event_name: "WorktreeRemove" })).toStrictEqual(ok);
});

it("creates the worktree on WorktreeCreate and prints only its path", () => {
  const r = tmp.repo();
  const made = worktreeHook({ cwd: r, hook_event_name: "WorktreeCreate", name: "z" });
  expect(made).toStrictEqual({ code: 0, stderr: "", stdout: `${wt(r, "z")}\n` });
  expect(git(wt(r, "z"), "branch", "--show-current")).toBe("wt/z");
});

it("fails the create with the reason, whether the name is unusable or the throw is not an Error", () => {
  const r = tmp.repo();
  const bad = worktreeHook({ cwd: r, hook_event_name: "WorktreeCreate", name: ".." });
  expect([bad.code, bad.stdout]).toStrictEqual([1, ""]);
  expect(bad.stderr).toContain('worktree name ".." has no usable');
  const hostile = {
    toString: () =>
      ((): never => {
        throw "boom";
      })(),
  };
  const input = {
    cwd: r,
    hook_event_name: "WorktreeCreate",
    name: hostile,
  } as unknown /* JSON cannot carry a throwing toString; this plants one */ as HookInput;
  expect(worktreeHook(input)).toStrictEqual({ code: 1, stderr: "boom", stdout: "" });
});

it("removes a worktree and its branch once the default branch holds it", () => {
  const r = tmp.repo();
  addWorktree(r, "k");
  expect(worktreeHook(remove(r, "k"))).toStrictEqual(ok);
  expect([fs.existsSync(wt(r, "k")), hasBranch(r, "wt/k")]).toStrictEqual([false, false]);
  expect(worktreeHook(remove(r, "k"))).toStrictEqual(ok);
});

it("removes the worktree but keeps a branch with commits main lacks", () => {
  const r = tmp.repo();
  addWorktree(r, "u");
  commitIn(wt(r, "u"), "u.txt");
  expect(worktreeHook(remove(r, "u"))).toStrictEqual(ok);
  expect([fs.existsSync(wt(r, "u")), hasBranch(r, "wt/u")]).toStrictEqual([false, true]);
});

it("finds the branch by the dir name when git already forgot the worktree", () => {
  const r = tmp.repo();
  addWorktree(r, "w");
  git(r, "worktree", "remove", wt(r, "w"));
  expect(worktreeHook(remove(r, "w"))).toStrictEqual(ok);
  expect(hasBranch(r, "wt/w")).toBe(false);
  expect(worktreeHook(remove(r, "never"))).toStrictEqual(ok);
});

it("removes a worktree whose dir is already gone", () => {
  const r = tmp.repo();
  addWorktree(r, "g");
  fs.rmSync(wt(r, "g"), { recursive: true });
  expect(worktreeHook(remove(r, "g"))).toStrictEqual(ok);
  expect(git(r, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  expect(hasBranch(r, "wt/g")).toBe(false);
});

it("leaves branches that are not wt/* or not on a branch alone", () => {
  const r = tmp.repo();
  addWorktree(r, "d");
  git(wt(r, "d"), "switch", "-q", "--detach");
  expect(worktreeHook(remove(r, "d"))).toStrictEqual(ok);
  expect(hasBranch(r, "wt/d")).toBe(true);
  addWorktree(r, "s");
  git(wt(r, "s"), "switch", "-q", "-c", "spike");
  expect(worktreeHook(remove(r, "s"))).toStrictEqual(ok);
  expect([fs.existsSync(wt(r, "s")), hasBranch(r, "spike")]).toStrictEqual([false, true]);
});

it("fails the removal with git's reason when a worktree that is still there will not go", () => {
  const r = tmp.repo();
  addWorktree(r, "l");
  git(r, "worktree", "lock", wt(r, "l"));
  const out = worktreeHook(remove(r, "l"));
  expect(out.code).toBe(1);
  expect(out.stderr).toContain("cannot remove a locked working tree");
  expect(fs.existsSync(wt(r, "l"))).toBe(true);
});
