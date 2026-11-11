import path from "node:path";

import { expect, it } from "vitest";

import { useTmp } from "./fixtures/gate-workspace.ts";
import { camelCall } from "./fixtures/hook-payload.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import type { ToolArgs } from "./gate-harness.ts";
import { GLOB_IGNORE } from "./gate-limits.ts";
import {
  DEFAULT_GREP_HEAD_LIMIT,
  DEFAULT_READ_LIMIT,
  DENY_FILE_BYTES,
  REASON_DENYLIST,
  REASON_FILE_SIZE,
} from "./gate.constants.ts";

const tmp = useTmp();
const rewrite = (updatedInput: ToolArgs) => ({ type: "rewrite", updatedInput });
const deny = (reason: string) => ({ reason, type: "deny" });

it("injects Grep head_limit when missing", () => {
  const out = processFatTools(camelCall("grep", { path: "src", pattern: "foo" }));
  expect(out).toStrictEqual(rewrite({ head_limit: DEFAULT_GREP_HEAD_LIMIT, path: "src", pattern: "foo" }));
});

it("injects Read limit when missing", () => {
  const file = tmp.file(100, "small.txt");
  const out = processFatTools(camelCall("read_file", { target_file: file }, { workspaceRoot: path.dirname(file) }));
  expect(out).toStrictEqual(rewrite({ limit: DEFAULT_READ_LIMIT, target_file: file }));
});

it("keeps an existing small head_limit", () => {
  expect(processFatTools(camelCall("Grep", { head_limit: 10, pattern: "x" }))).toBeNull();
});

it("rewrites head_limit over MAX to the default", () => {
  const out = processFatTools(camelCall("grep", { head_limit: 501, pattern: "x" }));
  expect(out).toStrictEqual(rewrite({ head_limit: DEFAULT_GREP_HEAD_LIMIT, pattern: "x" }));
});

it("denies files larger than 200KB even with limit", () => {
  const file = tmp.file(DENY_FILE_BYTES + 1, "huge.bin");
  const out = processFatTools(camelCall("Read", { file_path: file, limit: 20 }));
  expect(out).toStrictEqual(deny(REASON_FILE_SIZE));
});

it("denies denylist Read/Grep/Glob paths", () => {
  const denied = (tool: string, input: ToolArgs) => processFatTools(camelCall(tool, input));
  expect(denied("read_file", { target_file: "node_modules/x/index.js" })).toStrictEqual(deny(REASON_DENYLIST));
  expect(denied("grep", { path: "dist", pattern: "x" })).toStrictEqual(deny(REASON_DENYLIST));
  expect(denied("list_dir", { target_directory: ".git/objects" })).toStrictEqual(deny(REASON_DENYLIST));
  expect(denied("Read", { file_path: "bun.lock" })).toStrictEqual(deny(REASON_DENYLIST));
});

it("denies list_dir node_modules", () => {
  const out = processFatTools(camelCall("list_dir", { target_directory: "node_modules" }));
  expect(out).toStrictEqual(deny(REASON_DENYLIST));
});

it("injects ignore when list_dir has no path and is not denied", () => {
  expect(processFatTools(camelCall("list_dir", {}))).toStrictEqual(rewrite({ ignore: GLOB_IGNORE }));
});

it("denies glob **/node_modules/**", () => {
  const out = processFatTools(camelCall("glob", { glob_pattern: "**/node_modules/**" }));
  expect(out).toStrictEqual(deny(REASON_DENYLIST));
});

it("repo remains unscoped", () => {
  const out = processFatTools(camelCall("list_dir", { target_directory: "node_modules" }, { subagentType: "scout" }));
  expect(out).toBeNull();
});
