import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { childEnv } from "../env.ts";
import { useTmp } from "./fixtures/gate-workspace.ts";
import { stdinOf } from "./fixtures/worktree-repo.ts";
import { main, processFatTools } from "./gate-fat-tools.ts";
import { fatHookOutput } from "./gate-harness.ts";
import { stampPlanSave } from "./gate-review.ts";
import type { HookInput } from "./hook-input.ts";

const tmp = useTmp();

beforeEach(() => {
  vi.stubEnv("GIT_DIR", undefined);
  vi.stubEnv("GIT_INDEX_FILE", undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function plant() {
  return tmp.dir("gate-edges-");
}

function committedRepo() {
  const dir = plant();
  function git(...args: string[]) {
    return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
      cwd: dir,
      encoding: "utf8",
      env: childEnv({ GIT_DIR: undefined, GIT_INDEX_FILE: undefined }),
    });
  }
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".tmp/\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

describe("stampPlanSave", () => {
  it("does nothing for a payload that is not a hook call, has no session, or names no write", () => {
    const ws = plant();
    stampPlanSave(null);
    stampPlanSave({ toolInput: { file_path: "a.md" }, toolName: "Write", workspaceRoot: ws });
    stampPlanSave({ session_id: "s1", toolInput: {}, toolName: "NoSuchTool", workspaceRoot: ws });
    stampPlanSave({ session_id: "s1", toolInput: { command: "ls" }, toolName: "Bash", workspaceRoot: ws });
    stampPlanSave({ session_id: "s1", toolName: "Write", workspaceRoot: ws });
    stampPlanSave({ agent_type: "scout", session_id: "s1", toolInput: {}, toolName: "Write", workspaceRoot: ws });
    expect(fs.readdirSync(ws)).toStrictEqual([]);
  });
});

describe("a failure inside the shared-checkout check", () => {
  it("lets the call through instead of blocking it", () => {
    const repo = committedRepo();
    function call(lastUserInput: unknown): HookInput {
      return {
        conversationId: "c1",
        lastUserInput: lastUserInput /* a prompt whose text cannot be read */ as never,
        toolCall: { args: { CommandLine: "git stash", Cwd: repo }, name: "run_command" },
        workspacePaths: [repo],
      };
    }
    expect(processFatTools(call(""))).toMatchObject({ type: "deny" });
    const unreadable = {
      toString: () => {
        throw new Error("no text");
      },
    };
    expect(processFatTools(call(unreadable))).toBeNull();
  });
});

describe("fatHookOutput", () => {
  it("answers nothing for no verdict", () => {
    expect(fatHookOutput({}, null)).toBeNull();
  });
});

describe("main", () => {
  it("fails open with exit 0 when the reply cannot be written", () => {
    const ws = plant();
    const payload = JSON.stringify({ tool_input: { pattern: "x" }, tool_name: "Grep", workspaceRoot: ws });
    const io = {
      ...stdinOf(payload),
      write: () => {
        throw new Error("pipe closed");
      },
    };
    expect(main([], io)).toBe(0);
  });

  it("reads the process stdin and answers on stdout by default", () => {
    const ws = plant();
    const bytes = Buffer.from(JSON.stringify({ tool_input: { pattern: "x" }, tool_name: "Grep", workspaceRoot: ws }));
    vi.spyOn(fs, "readSync").mockImplementationOnce((_fd, into) =>
      bytes.copy(new Uint8Array(into.buffer, into.byteOffset, into.byteLength)),
    );
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(main()).toBe(0);
    expect(String(out.mock.calls[0]?.[0])).toContain('"head_limit":50');
  });
});
