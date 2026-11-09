import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { childEnv } from "../env.ts";
import type { HookInput } from "./hook-input.ts";
import type { HookIo } from "./hook-io.ts";
import { fatHookOutput, main, processFatTools, stampPlanSave } from "./gate-fat-tools.ts";

const tmpDirs: string[] = [];

beforeEach(() => {
  vi.stubEnv("GIT_DIR", undefined);
  vi.stubEnv("GIT_INDEX_FILE", undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function plant() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gate-edges-")));
  tmpDirs.push(dir);
  return dir;
}

function committedRepo() {
  const dir = plant();
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
      cwd: dir,
      env: childEnv({ GIT_DIR: undefined, GIT_INDEX_FILE: undefined }),
      encoding: "utf8",
    });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".tmp/\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

function fakeIo(payload: string, write: (text: string) => void): HookIo {
  let sent = false;
  return {
    readChunk: () => {
      if (sent) return null;
      sent = true;
      return Buffer.from(payload);
    },
    write,
  };
}

describe("stampPlanSave", () => {
  it("does nothing for a payload that is not a hook call, has no session, or names no write", () => {
    const ws = plant();
    stampPlanSave(null);
    stampPlanSave({ workspaceRoot: ws, toolName: "Write", toolInput: { file_path: "a.md" } });
    stampPlanSave({ workspaceRoot: ws, session_id: "s1", toolName: "NoSuchTool", toolInput: {} });
    stampPlanSave({ workspaceRoot: ws, session_id: "s1", toolName: "Bash", toolInput: { command: "ls" } });
    stampPlanSave({ workspaceRoot: ws, session_id: "s1", toolName: "Write" });
    stampPlanSave({ workspaceRoot: ws, session_id: "s1", agent_type: "scout", toolName: "Write", toolInput: {} });
    expect(fs.readdirSync(ws)).toEqual([]);
  });
});

describe("a failure inside the shared-checkout check", () => {
  it("lets the call through instead of blocking it", () => {
    const repo = committedRepo();
    const call = (lastUserInput: unknown): HookInput => ({
      conversationId: "c1",
      workspacePaths: [repo],
      lastUserInput: lastUserInput /* a prompt whose text cannot be read */ as never,
      toolCall: { name: "run_command", args: { CommandLine: "git stash", Cwd: repo } },
    });
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
    const payload = JSON.stringify({ workspaceRoot: ws, tool_name: "Grep", tool_input: { pattern: "x" } });
    const io = fakeIo(payload, () => {
      throw new Error("pipe closed");
    });
    expect(main([], io)).toBe(0);
  });

  it("reads the process stdin and answers on stdout by default", () => {
    const ws = plant();
    const bytes = Buffer.from(JSON.stringify({ workspaceRoot: ws, tool_name: "Grep", tool_input: { pattern: "x" } }));
    vi.spyOn(fs, "readSync").mockImplementationOnce((_fd, into) =>
      bytes.copy(new Uint8Array(into.buffer, into.byteOffset, into.byteLength)),
    );
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(main()).toBe(0);
    expect(String(out.mock.calls[0]?.[0])).toContain('"head_limit":50');
  });
});
