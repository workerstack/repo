import { expect, it } from "vitest";
import { processFatTools } from "./gate-fat-tools.ts";
import type { ToolArgs } from "./gate-harness.ts";
import {
  CHILD_GREP_HEAD_LIMIT,
  CHILD_READ_LIMIT,
  DENY_FILE_BYTES,
  REASON_DENYLIST,
  REASON_FILE_SIZE,
} from "./gate.constants.ts";
import { camelCall } from "./fixtures/hook-payload.ts";
import { useTmp } from "./fixtures/gate-workspace.ts";

const tmp = useTmp();
const rewrite = (updatedInput: ToolArgs) => ({ type: "rewrite", updatedInput });
const deny = (reason: string) => ({ type: "deny", reason });
const asChild = (type: string, tool: string, input: ToolArgs) =>
  processFatTools(camelCall(tool, input, { subagentType: type }));

it("injects 150/400 for an unknown child; scout is unscoped", () => {
  const file = tmp.file(100, "child-small.txt");
  const grep = asChild("explore", "grep", { pattern: "foo" });
  expect(grep).toEqual(rewrite({ pattern: "foo", head_limit: CHILD_GREP_HEAD_LIMIT }));
  const read = asChild("explore", "read_file", { target_file: file });
  expect(read).toEqual(rewrite({ target_file: file, limit: CHILD_READ_LIMIT }));
  expect(asChild("scout", "read_file", { target_file: "node_modules/x.js" })).toBeNull();
});

it("researcher gets scout's exemption from the child Read and Grep limits", () => {
  expect(asChild("researcher", "read_file", { target_file: "vendor/x.js" })).toBeNull();
  expect(asChild("researcher", "grep", { pattern: "foo" })).toBeNull();
});

it("unknown child Grep/Glob get child limits; not denied", () => {
  const grep = asChild("explore", "grep", { pattern: "foo" });
  expect(grep).toEqual(rewrite({ pattern: "foo", head_limit: CHILD_GREP_HEAD_LIMIT }));
  expect(asChild("explore", "run_terminal_command", { command: "pwd" })).toBeNull();
});

it("injects 400 for unknown child Read; unknown sergeant Grep still 150", () => {
  const file = tmp.file(80, "thinker-small.txt");
  const read = asChild("thinker", "read_file", { target_file: file });
  expect(read).toEqual(rewrite({ target_file: file, limit: CHILD_READ_LIMIT }));
  const grep = asChild("sergeant", "grep", { pattern: "bar" });
  expect(grep).toEqual(rewrite({ pattern: "bar", head_limit: CHILD_GREP_HEAD_LIMIT }));
});

it("denies child files larger than 200KB", () => {
  const file = tmp.file(DENY_FILE_BYTES + 1, "child-huge.bin");
  expect(asChild("explore", "Read", { file_path: file, limit: 20 })).toEqual(deny(REASON_FILE_SIZE));
  expect(asChild("thinker", "read_file", { target_file: file, limit: 20 })).toEqual(deny(REASON_FILE_SIZE));
});

it("denies a child's path denylist and fat bash", () => {
  expect(asChild("explore", "read_file", { target_file: "bun.lock" })).toEqual(deny(REASON_DENYLIST));
  const snake = { subagent_type: "explore" };
  const cat = processFatTools(camelCall("run_terminal_command", { command: "cat node_modules/x" }, snake));
  expect(cat).toEqual(deny(REASON_DENYLIST));
  expect(asChild("explore", "Bash", { command: "curl https://example.com" })?.type).toBe("rewrite");
  expect(asChild("explore", "Bash", { command: "rtk bun test --ultra-compact" })).toBeNull();
});
