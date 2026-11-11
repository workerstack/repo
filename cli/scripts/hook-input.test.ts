import { expect, it } from "vitest";

import { isRecord, parseHookInput } from "./hook-input.ts";

it("parseHookInput: reads a Claude payload", () => {
  const input = parseHookInput(
    JSON.stringify({
      agent_type: "scout",
      cwd: "/repo",
      hook_event_name: "PreToolUse",
      session_id: "s1",
      tool_input: { file_path: "/repo/a.ts" },
      tool_name: "Read",
      transcript_path: "/t.jsonl",
    }),
  );
  expect(input?.session_id).toBe("s1");
  expect(input?.tool_input).toStrictEqual({ file_path: "/repo/a.ts" });
  expect(input?.agent_type).toBe("scout");
});

it("parseHookInput: reads spawn markers on a nested agent object", () => {
  const input = parseHookInput(JSON.stringify({ agent: { id: 7, spawnedBy: "p1", spawned_by: "p2" } }));
  expect(input?.agent).toStrictEqual({ spawnedBy: "p1", spawned_by: "p2" });
});

it("parseHookInput: reads the Claude worktree fields", () => {
  const create = parseHookInput(JSON.stringify({ cwd: "/repo", hook_event_name: "WorktreeCreate", name: "feat" }));
  expect(create?.name).toBe("feat");
  const remove = parseHookInput(
    JSON.stringify({ hook_event_name: "WorktreeRemove", name: 3, worktree_path: "/repo/.worktrees/feat" }),
  );
  expect(remove?.worktree_path).toBe("/repo/.worktrees/feat");
  expect(remove?.name).toBeUndefined();
});

it("parseHookInput: reads a Codex payload", () => {
  const input = parseHookInput(
    JSON.stringify({
      model: "gpt",
      session_id: "s2",
      tool_input: { command: "ls" },
      tool_name: "Bash",
      turn_id: "t1",
    }),
  );
  expect(input?.turn_id).toBe("t1");
  expect(input?.model).toBe("gpt");
  expect(input?.tool_input).toStrictEqual({ command: "ls" });
});

it("parseHookInput: reads a Cursor payload", () => {
  const input = parseHookInput(
    JSON.stringify({
      conversationId: "c1",
      cursor_version: "1.0",
      hookEventName: "preToolUse",
      toolInput: { command: "ls", cwd: "/r" },
      toolName: "Shell",
    }),
  );
  expect(input?.cursor_version).toBe("1.0");
  expect(input?.conversationId).toBe("c1");
  expect(input?.toolInput).toStrictEqual({ command: "ls", cwd: "/r" });
});

it("parseHookInput: reads a Grok payload", () => {
  const input = parseHookInput(
    JSON.stringify({
      agent: { type: "scout" },
      lastAssistantMessage: "done",
      sessionId: "g1",
      stopHookActive: false,
    }),
  );
  expect(input?.sessionId).toBe("g1");
  expect(input?.agent).toStrictEqual({ type: "scout" });
  expect(input?.lastAssistantMessage).toBe("done");
});

it("parseHookInput: reads the workspace fields and keeps only string paths", () => {
  const input = parseHookInput(
    JSON.stringify({ workspacePaths: ["/c", 3, null, "/d"], workspaceRoot: "/a", workspace_root: "/b" }),
  );
  expect(input?.workspaceRoot).toBe("/a");
  expect(input?.workspace_root).toBe("/b");
  expect(input?.workspacePaths).toStrictEqual(["/c", "/d"]);
});

it("parseHookInput: drops workspace fields of the wrong type", () => {
  const input = parseHookInput(JSON.stringify({ workspacePaths: "/x", workspaceRoot: 1, workspace_root: {} }));
  expect(input).toStrictEqual({});
});

it("parseHookInput: returns null for invalid JSON", () => {
  expect(parseHookInput("{nope")).toBeNull();
  expect(parseHookInput("")).toBeNull();
});

it("parseHookInput: returns null for a non-object", () => {
  expect(parseHookInput("null")).toBeNull();
  expect(parseHookInput("[1]")).toBeNull();
  expect(parseHookInput('"x"')).toBeNull();
  expect(parseHookInput("3")).toBeNull();
});

it("parseHookInput: drops a wrong-typed field and keeps the rest", () => {
  const input = parseHookInput(
    JSON.stringify({
      cwd: null,
      extra: "ignored",
      session_id: "s1",
      stopHookActive: true,
      stop_hook_active: "yes",
      toolInput: ["a"],
      tool_input: "x",
      tool_name: 5,
    }),
  );
  expect(input).toStrictEqual({ session_id: "s1", stopHookActive: true });
});

it("parseHookInput: keeps only well-typed parts of toolCall and agent", () => {
  expect(
    parseHookInput(JSON.stringify({ agent: { id: 2, name: "n", type: "scout" }, toolCall: { args: [], name: 1 } })),
  ).toStrictEqual({
    agent: { name: "n", type: "scout" },
    toolCall: {},
  });
  expect(parseHookInput(JSON.stringify({ agent: "scout", toolCall: { args: { a: 1 }, name: "Read" } }))).toStrictEqual({
    agent: "scout",
    toolCall: { args: { a: 1 }, name: "Read" },
  });
  expect(parseHookInput(JSON.stringify({ agent: 3, toolCall: "x" }))).toStrictEqual({});
});

it("isRecord takes a plain object and rejects null, arrays and scalars", () => {
  expect(isRecord({ a: 1 })).toBe(true);
  expect(isRecord(null)).toBe(false);
  expect(isRecord([])).toBe(false);
  expect(isRecord("x")).toBe(false);
});
