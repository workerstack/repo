import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processFatTools } from "./gate-fat-tools.ts";
import { type ToolArgs } from "./gate-harness.ts";
import { GLOB_IGNORE } from "./gate-limits.ts";
import {
  DEFAULT_GREP_HEAD_LIMIT,
  DEFAULT_READ_LIMIT,
  DENY_FILE_BYTES,
  REASON_DENYLIST,
  REASON_FILE_SIZE,
} from "./gate.constants.ts";

const tmpDirs: string[] = [];
let ws: string;

beforeEach(() => {
  vi.stubEnv("GIT_DIR", undefined);
  vi.stubEnv("GIT_INDEX_FILE", undefined);
  ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gate-limits-")));
  tmpDirs.push(ws);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function call(toolName: string, toolInput: ToolArgs, cwd = ws) {
  return processFatTools({ workspaceRoot: ws, cwd, toolName, toolInput });
}

describe("glob", () => {
  it("adds the ignore list for a blank or an absolute path", () => {
    expect(call("Glob", { path: "  " })).toEqual({
      type: "rewrite",
      updatedInput: { path: "  ", ignore: GLOB_IGNORE },
    });
    const abs = path.join(ws, "src");
    expect(call("Glob", { path: abs })).toEqual({ type: "rewrite", updatedInput: { path: abs, ignore: GLOB_IGNORE } });
  });

  it("leaves a glob that already names its ignore list alone", () => {
    expect(call("Glob", { path: ".", ignore: ["x"] })).toBeNull();
  });

  it("denies a relative path that resolves into a denied dir", () => {
    const denied = path.join(ws, "dist");
    fs.mkdirSync(denied);
    expect(call("Glob", { path: "." }, denied)).toEqual({ type: "deny", reason: REASON_DENYLIST });
    expect(call("Glob", { path: "sub" }, denied)).toEqual({ type: "deny", reason: REASON_DENYLIST });
  });
});

describe("grep head_limit", () => {
  it("spells the injected and the capped limit in camelCase for a camelCase call", () => {
    expect(call("Grep", { pattern: "x", targetDirectory: "src" })).toEqual({
      type: "rewrite",
      updatedInput: { pattern: "x", targetDirectory: "src", headLimit: DEFAULT_GREP_HEAD_LIMIT },
    });
    expect(call("Grep", { pattern: "x", headLimit: 900 })).toEqual({
      type: "rewrite",
      updatedInput: { pattern: "x", headLimit: DEFAULT_GREP_HEAD_LIMIT },
    });
  });

  it("treats a limit that is not a number as a limit the caller set", () => {
    expect(call("Grep", { pattern: "x", head_limit: "many" })).toBeNull();
    expect(call("Grep", { pattern: "x", head_limit: "" })).toBeNull();
    expect(call("Grep", { pattern: "x", head_limit: null })).toBeNull();
  });
});

describe("read", () => {
  it("caps a limit above the maximum", () => {
    const file = path.join(ws, "a.txt");
    fs.writeFileSync(file, "a\n");
    expect(call("Read", { file_path: file, limit: 900 })).toEqual({
      type: "rewrite",
      updatedInput: { file_path: file, limit: DEFAULT_READ_LIMIT },
    });
  });

  it("adds a limit when the call names no file", () => {
    expect(call("Read", {})).toEqual({ type: "rewrite", updatedInput: { limit: DEFAULT_READ_LIMIT } });
  });

  it("reads the file from any of the host spellings", () => {
    const big = path.join(ws, "big.bin");
    fs.writeFileSync(big, Buffer.alloc(DENY_FILE_BYTES + 1));
    expect(call("Read", { targetFile: big })).toEqual({ type: "deny", reason: REASON_FILE_SIZE });
    expect(call("Read", { filePath: big })).toEqual({ type: "deny", reason: REASON_FILE_SIZE });
    expect(call("Read", { target_file: big })).toEqual({ type: "deny", reason: REASON_FILE_SIZE });
  });
});

describe("codex apply_patch", () => {
  it("passes an empty patch", () => {
    const payload = {
      workspaceRoot: ws,
      cwd: ws,
      turn_id: "t1",
      model: "m",
      toolName: "apply_patch",
      toolInput: { command: "" },
    };
    expect(processFatTools(payload)).toBeNull();
  });
});
