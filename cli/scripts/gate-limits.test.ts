import path from "node:path";

import { expect, it } from "vitest";

import { deny } from "./__fixtures__/checkout-calls.ts";
import { gated, rewrite } from "./__fixtures__/gate-answers.ts";
import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { GLOB_IGNORE } from "./gate-limits.ts";
import {
  DEFAULT_GREP_HEAD_LIMIT,
  DEFAULT_READ_LIMIT,
  DENY_FILE_BYTES,
  REASON_DENYLIST,
  REASON_FILE_SIZE,
} from "./gate.constants.ts";

const tmp = useTmp();

it("injects Grep head_limit when missing", () => {
  const out = gated("grep", { path: "src", pattern: "foo" });
  expect(out).toStrictEqual(rewrite({ head_limit: DEFAULT_GREP_HEAD_LIMIT, path: "src", pattern: "foo" }));
});

it("injects Read limit when missing", () => {
  const file = tmp.file(100, "small.txt");
  const out = gated("read_file", { target_file: file }, { workspaceRoot: path.dirname(file) });
  expect(out).toStrictEqual(rewrite({ limit: DEFAULT_READ_LIMIT, target_file: file }));
});

it("keeps an existing small head_limit", () => {
  expect(gated("Grep", { head_limit: 10, pattern: "x" })).toBeNull();
});

it("rewrites head_limit over MAX to the default", () => {
  const out = gated("grep", { head_limit: 501, pattern: "x" });
  expect(out).toStrictEqual(rewrite({ head_limit: DEFAULT_GREP_HEAD_LIMIT, pattern: "x" }));
});

it("denies files larger than 200KB even with limit", () => {
  const file = tmp.file(DENY_FILE_BYTES + 1, "huge.bin");
  const out = gated("Read", { file_path: file, limit: 20 });
  expect(out).toStrictEqual(deny(REASON_FILE_SIZE));
});

it("denies denylist Read/Grep/Glob paths", () => {
  expect(gated("read_file", { target_file: "node_modules/x/index.js" })).toStrictEqual(deny(REASON_DENYLIST));
  expect(gated("grep", { path: "dist", pattern: "x" })).toStrictEqual(deny(REASON_DENYLIST));
  expect(gated("list_dir", { target_directory: ".git/objects" })).toStrictEqual(deny(REASON_DENYLIST));
  expect(gated("Read", { file_path: "bun.lock" })).toStrictEqual(deny(REASON_DENYLIST));
});

it("denies list_dir node_modules", () => {
  const out = gated("list_dir", { target_directory: "node_modules" });
  expect(out).toStrictEqual(deny(REASON_DENYLIST));
});

it("injects ignore when list_dir has no path and is not denied", () => {
  expect(gated("list_dir", {})).toStrictEqual(rewrite({ ignore: GLOB_IGNORE }));
});

it("denies glob **/node_modules/**", () => {
  const out = gated("glob", { glob_pattern: "**/node_modules/**" });
  expect(out).toStrictEqual(deny(REASON_DENYLIST));
});

it("repo remains unscoped", () => {
  const out = gated("list_dir", { target_directory: "node_modules" }, { subagentType: "scout" });
  expect(out).toBeNull();
});
