import fs from "node:fs";

import { afterEach, expect, it } from "vitest";

import { git, hasBranch, mainIn, scratch, wt } from "./fixtures/worktree-repo.ts";

const tmp = scratch();
afterEach(() => tmp.cleanup());

it("hook creates the worktree named on stdin and prints only its path", () => {
  const r = tmp.repo();
  const body = JSON.stringify({ cwd: r, hook_event_name: "WorktreeCreate", name: "hk" });
  expect(mainIn(r, ["hook"], body)).toStrictEqual({ code: 0, stderr: "", stdout: `${wt(r, "hk")}\n` });
  expect(git(wt(r, "hk"), "branch", "--show-current")).toBe("wt/hk");
});

it("hook removes the worktree named on stdin", () => {
  const r = tmp.repo();
  mainIn(r, ["add", "gone"]);
  const body = JSON.stringify({ cwd: r, hook_event_name: "WorktreeRemove", worktree_path: wt(r, "gone") });
  expect(mainIn(r, ["hook"], body)).toStrictEqual({ code: 0, stderr: "", stdout: "" });
  expect([fs.existsSync(wt(r, "gone")), hasBranch(r, "wt/gone")]).toStrictEqual([false, false]);
});

it("hook prints the failure on stderr and exits 1", () => {
  const r = tmp.repo();
  const body = JSON.stringify({ cwd: r, hook_event_name: "WorktreeCreate", name: ".." });
  const out = mainIn(r, ["hook"], body);
  expect([out.code, out.stdout]).toStrictEqual([1, ""]);
  expect(out.stderr).toBe('worktree name ".." has no usable characters; use letters, digits, ".", "_" or "-"\n');
});

it("hook does nothing for an empty payload, another event, or JSON that is not an object", () => {
  const r = tmp.repo();
  for (const body of ["", "[1]", "5", JSON.stringify({ cwd: r, hook_event_name: "SessionStart" })])
    expect(mainIn(r, ["hook"], body), body).toStrictEqual({ code: 0, stderr: "", stdout: "" });
});

it("hook fails a payload that is not JSON with the parse error", () => {
  const r = tmp.repo();
  const out = mainIn(r, ["hook"], "{not json");
  expect([out.code, out.stdout]).toStrictEqual([1, ""]);
  expect(out.stderr).toMatch(/JSON|Expected|property name/);
});
