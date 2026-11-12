import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { processFatTools } from "./gate-fat-tools.ts";
import { isHookObject } from "./gate-harness.ts";
import { relInside } from "./gate-paths.ts";
import { DEFAULT_GREP_HEAD_LIMIT, REASON_DENYLIST } from "./gate.constants.ts";
import type { HookInput } from "./hook-input.ts";

const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

/** A fresh git repo, so the hook's cwd is its own root. */
function repoRoot(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gate-guards-")));
  roots.push(dir);
  spawnSync("git", ["init", "-q"], { cwd: dir });

  return dir;
}

function claude(cwd: string, tool: string, input: Record<string, unknown>): HookInput {
  return {
    cwd,
    tool_input: input,
    tool_name: tool,
  };
}

function codex(cwd: string, tool: string, input: Record<string, unknown>): HookInput {
  return {
    ...claude(cwd, tool, input),
    model: "m",
    turn_id: "t1",
  };
}

function asScout(data: HookInput): HookInput {
  return { ...data, subagent_type: "scout" };
}

function deny(reason: string) {
  return { reason, type: "deny" };
}

describe("payload guards", () => {
  it("accept an object and reject null, arrays and scalars", () => {
    expect(isHookObject({})).toBe(true);

    for (const value of [null, undefined, [], "text"]) expect(isHookObject(value)).toBe(false);
  });
});

describe("relInside", () => {
  it("is null for the base itself, a path outside it and a path on another drive", () => {
    expect(relInside("/a", "/a/b/c")).toBe("b/c");
    expect(relInside("/a", "/a")).toBeNull();
    expect(relInside("/a", "/b")).toBeNull();
    expect(relInside("C:\\a", "D:\\b", path.win32)).toBeNull();
  });
});

describe("processFatTools guard table", () => {
  it("passes on when a guard returns undefined, until one answers", () => {
    const cwd = repoRoot();
    expect(processFatTools(claude(cwd, "Bash", { command: "cat bun.lock" }))).toStrictEqual(deny(REASON_DENYLIST));
    expect(processFatTools(claude(cwd, "Bash", { command: "git status" }))).toBeNull();
  });

  it("stops with no answer on null, even where a later guard would answer", () => {
    const cwd = repoRoot();
    const grep = claude(cwd, "Grep", { path: "node_modules", pattern: "x" });
    expect(processFatTools(grep)).toStrictEqual(deny(REASON_DENYLIST));
    expect(processFatTools(asScout(grep))).toBeNull();
    expect(processFatTools(codex(cwd, "Bash", { command: "cat bun.lock" }))).toStrictEqual(deny(REASON_DENYLIST));
    expect(processFatTools(codex(cwd, "apply_patch", { command: "cat bun.lock" }))).toBeNull();
    expect(processFatTools(claude(cwd, "Write", { content: "x", file_path: path.join(cwd, "src.ts") }))).toBeNull();
  });

  it("answers with the object the first answering guard returns", () => {
    const cwd = repoRoot();
    expect(processFatTools(claude(cwd, "Grep", { path: "src", pattern: "x" }))).toStrictEqual({
      type: "rewrite",
      updatedInput: { head_limit: DEFAULT_GREP_HEAD_LIMIT, path: "src", pattern: "x" },
    });
  });

  it("holds a scout to the worktree guard before its own exemption", () => {
    const cwd = repoRoot();
    const stray = asScout(claude(cwd, "Bash", { command: "git worktree add ../elsewhere" }));
    expect(JSON.stringify(processFatTools(stray))).toMatch(/"reason":"worktrees live in /);
  });
});
