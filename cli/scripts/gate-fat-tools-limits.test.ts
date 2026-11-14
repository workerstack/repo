import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { removeTemps } from "../__fixtures__/remove-temps.ts";
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

  removeTemps(tmpDirs.splice(0));
});

function call(toolName: string, toolInput: ToolArgs, cwd = ws) {
  return processFatTools({ cwd, toolInput, toolName, workspaceRoot: ws });
}

describe("glob", () => {
  it("adds the ignore list for a blank or an absolute path", () => {
    expect(call("Glob", { path: "  " })).toStrictEqual({
      type: "rewrite",
      updatedInput: { ignore: GLOB_IGNORE, path: "  " },
    });
    const abs = path.join(ws, "src");
    expect(call("Glob", { path: abs })).toStrictEqual({
      type: "rewrite",
      updatedInput: { ignore: GLOB_IGNORE, path: abs },
    });
  });

  it("leaves a glob that already names its ignore list alone", () => {
    expect(call("Glob", { ignore: ["x"], path: "." })).toBeNull();
  });

  it("denies a relative path that resolves into a denied dir", () => {
    const denied = path.join(ws, "dist");
    fs.mkdirSync(denied);
    expect(call("Glob", { path: "." }, denied)).toStrictEqual({ reason: REASON_DENYLIST, type: "deny" });
    expect(call("Glob", { path: "sub" }, denied)).toStrictEqual({ reason: REASON_DENYLIST, type: "deny" });
  });
});

describe("grep head_limit", () => {
  it("spells the injected and the capped limit in camelCase for a camelCase call", () => {
    expect(call("Grep", { pattern: "x", targetDirectory: "src" })).toStrictEqual({
      type: "rewrite",
      updatedInput: { headLimit: DEFAULT_GREP_HEAD_LIMIT, pattern: "x", targetDirectory: "src" },
    });
    expect(call("Grep", { headLimit: 900, pattern: "x" })).toStrictEqual({
      type: "rewrite",
      updatedInput: { headLimit: DEFAULT_GREP_HEAD_LIMIT, pattern: "x" },
    });
  });

  it("treats a limit that is not a number as a limit the caller set", () => {
    expect(call("Grep", { head_limit: "many", pattern: "x" })).toBeNull();
    expect(call("Grep", { head_limit: "", pattern: "x" })).toBeNull();
    expect(call("Grep", { head_limit: null, pattern: "x" })).toBeNull();
  });
});

describe("read", () => {
  it("caps a limit above the maximum", () => {
    const file = path.join(ws, "a.txt");
    fs.writeFileSync(file, "a\n");
    expect(call("Read", { file_path: file, limit: 900 })).toStrictEqual({
      type: "rewrite",
      updatedInput: { file_path: file, limit: DEFAULT_READ_LIMIT },
    });
  });

  it("adds a limit when the call names no file", () => {
    expect(call("Read", {})).toStrictEqual({ type: "rewrite", updatedInput: { limit: DEFAULT_READ_LIMIT } });
  });

  it("reads the file from any of the host spellings", () => {
    const big = path.join(ws, "big.bin");
    fs.writeFileSync(big, Buffer.alloc(DENY_FILE_BYTES + 1));
    expect(call("Read", { targetFile: big })).toStrictEqual({ reason: REASON_FILE_SIZE, type: "deny" });
    expect(call("Read", { filePath: big })).toStrictEqual({ reason: REASON_FILE_SIZE, type: "deny" });
    expect(call("Read", { target_file: big })).toStrictEqual({ reason: REASON_FILE_SIZE, type: "deny" });
  });
});

describe("codex apply_patch", () => {
  it("passes an empty patch", () => {
    const payload = {
      cwd: ws,
      model: "m",
      toolInput: { command: "" },
      toolName: "apply_patch",
      turn_id: "t1",
      workspaceRoot: ws,
    };

    expect(processFatTools(payload)).toBeNull();
  });
});
