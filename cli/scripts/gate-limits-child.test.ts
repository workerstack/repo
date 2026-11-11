import { expect, it } from "vitest";

import { deny } from "./fixtures/checkout-calls.ts";
import { gated, rewrite } from "./fixtures/gate-answers.ts";
import { useTmp } from "./fixtures/gate-workspace.ts";
import type { ToolArgs } from "./gate-harness.ts";
import {
  CHILD_GREP_HEAD_LIMIT,
  CHILD_READ_LIMIT,
  DENY_FILE_BYTES,
  REASON_DENYLIST,
  REASON_FILE_SIZE,
} from "./gate.constants.ts";

const tmp = useTmp();
function asChild(type: string, tool: string, input: ToolArgs) {
  return gated(tool, input, { subagentType: type });
}

it("injects 150/400 for an unknown child; scout is unscoped", () => {
  const file = tmp.file(100, "child-small.txt");
  const grep = asChild("explore", "grep", { pattern: "foo" });
  expect(grep).toStrictEqual(rewrite({ head_limit: CHILD_GREP_HEAD_LIMIT, pattern: "foo" }));
  const read = asChild("explore", "read_file", { target_file: file });
  expect(read).toStrictEqual(rewrite({ limit: CHILD_READ_LIMIT, target_file: file }));
  expect(asChild("scout", "read_file", { target_file: "node_modules/x.js" })).toBeNull();
});

it("researcher gets scout's exemption from the child Read and Grep limits", () => {
  expect(asChild("researcher", "read_file", { target_file: "vendor/x.js" })).toBeNull();
  expect(asChild("researcher", "grep", { pattern: "foo" })).toBeNull();
});

it("unknown child Grep/Glob get child limits; not denied", () => {
  const grep = asChild("explore", "grep", { pattern: "foo" });
  expect(grep).toStrictEqual(rewrite({ head_limit: CHILD_GREP_HEAD_LIMIT, pattern: "foo" }));
  expect(asChild("explore", "run_terminal_command", { command: "pwd" })).toBeNull();
});

it("injects 400 for unknown child Read; unknown sergeant Grep still 150", () => {
  const file = tmp.file(80, "thinker-small.txt");
  const read = asChild("thinker", "read_file", { target_file: file });
  expect(read).toStrictEqual(rewrite({ limit: CHILD_READ_LIMIT, target_file: file }));
  const grep = asChild("sergeant", "grep", { pattern: "bar" });
  expect(grep).toStrictEqual(rewrite({ head_limit: CHILD_GREP_HEAD_LIMIT, pattern: "bar" }));
});

it("denies child files larger than 200KB", () => {
  const file = tmp.file(DENY_FILE_BYTES + 1, "child-huge.bin");
  expect(asChild("explore", "Read", { file_path: file, limit: 20 })).toStrictEqual(deny(REASON_FILE_SIZE));
  expect(asChild("thinker", "read_file", { limit: 20, target_file: file })).toStrictEqual(deny(REASON_FILE_SIZE));
});

it("denies a child's path denylist and fat bash", () => {
  expect(asChild("explore", "read_file", { target_file: "bun.lock" })).toStrictEqual(deny(REASON_DENYLIST));
  const snake = { subagent_type: "explore" };
  const cat = gated("run_terminal_command", { command: "cat node_modules/x" }, snake);
  expect(cat).toStrictEqual(deny(REASON_DENYLIST));
  expect(asChild("explore", "Bash", { command: "curl https://example.com" })?.type).toBe("rewrite");
  expect(asChild("explore", "Bash", { command: "rtk bun test --ultra-compact" })).toBeNull();
});
