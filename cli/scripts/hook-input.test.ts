import { expect, it } from "vitest";
import { isRecord, parseHookInput } from "./hook-input.ts";

it("parseHookInput: reads a Claude payload", () => {
  const input = parseHookInput(
    JSON.stringify({
      session_id: "s1",
      cwd: "/repo",
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/repo/a.ts" },
      transcript_path: "/t.jsonl",
      agent_type: "scout",
    }),
  );
  expect(input?.session_id).toBe("s1");
  expect(input?.tool_input).toStrictEqual({ file_path: "/repo/a.ts" });
  expect(input?.agent_type).toBe("scout");
});

it("parseHookInput: reads spawn markers on a nested agent object", () => {
  const input = parseHookInput(JSON.stringify({ agent: { spawnedBy: "p1", spawned_by: "p2", id: 7 } }));
  expect(input?.agent).toStrictEqual({ spawnedBy: "p1", spawned_by: "p2" });
});

it("parseHookInput: reads the Claude worktree fields", () => {
  const create = parseHookInput(JSON.stringify({ hook_event_name: "WorktreeCreate", name: "feat", cwd: "/repo" }));
  expect(create?.name).toBe("feat");
  const remove = parseHookInput(
    JSON.stringify({ hook_event_name: "WorktreeRemove", worktree_path: "/repo/.worktrees/feat", name: 3 }),
  );
  expect(remove?.worktree_path).toBe("/repo/.worktrees/feat");
  expect(remove?.name).toBeUndefined();
});

it("parseHookInput: reads a Codex payload", () => {
  const input = parseHookInput(
    JSON.stringify({
      session_id: "s2",
      turn_id: "t1",
      model: "gpt",
      tool_name: "Bash",
      tool_input: { command: "ls" },
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
      toolName: "Shell",
      toolInput: { command: "ls", cwd: "/r" },
    }),
  );
  expect(input?.cursor_version).toBe("1.0");
  expect(input?.conversationId).toBe("c1");
  expect(input?.toolInput).toStrictEqual({ command: "ls", cwd: "/r" });
});

it("parseHookInput: reads a Grok payload", () => {
  const input = parseHookInput(
    JSON.stringify({
      sessionId: "g1",
      agent: { type: "scout" },
      lastAssistantMessage: "done",
      stopHookActive: false,
    }),
  );
  expect(input?.sessionId).toBe("g1");
  expect(input?.agent).toStrictEqual({ type: "scout" });
  expect(input?.lastAssistantMessage).toBe("done");
});

it("parseHookInput: reads the workspace fields and keeps only string paths", () => {
  const input = parseHookInput(
    JSON.stringify({ workspaceRoot: "/a", workspace_root: "/b", workspacePaths: ["/c", 3, null, "/d"] }),
  );
  expect(input?.workspaceRoot).toBe("/a");
  expect(input?.workspace_root).toBe("/b");
  expect(input?.workspacePaths).toStrictEqual(["/c", "/d"]);
});

it("parseHookInput: drops workspace fields of the wrong type", () => {
  const input = parseHookInput(JSON.stringify({ workspaceRoot: 1, workspace_root: {}, workspacePaths: "/x" }));
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
      session_id: "s1",
      tool_name: 5,
      tool_input: "x",
      toolInput: ["a"],
      stop_hook_active: "yes",
      stopHookActive: true,
      cwd: null,
      extra: "ignored",
    }),
  );
  expect(input).toStrictEqual({ session_id: "s1", stopHookActive: true });
});

it("parseHookInput: keeps only well-typed parts of toolCall and agent", () => {
  expect(
    parseHookInput(JSON.stringify({ toolCall: { name: 1, args: [] }, agent: { type: "scout", id: 2, name: "n" } })),
  ).toStrictEqual({
    toolCall: {},
    agent: { type: "scout", name: "n" },
  });
  expect(parseHookInput(JSON.stringify({ toolCall: { name: "Read", args: { a: 1 } }, agent: "scout" }))).toStrictEqual({
    toolCall: { name: "Read", args: { a: 1 } },
    agent: "scout",
  });
  expect(parseHookInput(JSON.stringify({ toolCall: "x", agent: 3 }))).toStrictEqual({});
});

it("isRecord takes a plain object and rejects null, arrays and scalars", () => {
  expect(isRecord({ a: 1 })).toBe(true);
  expect(isRecord(null)).toBe(false);
  expect(isRecord([])).toBe(false);
  expect(isRecord("x")).toBe(false);
});
