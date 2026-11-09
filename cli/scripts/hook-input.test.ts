import { describe, expect, it } from "vitest";
import { parseHookInput } from "./hook-input.ts";

describe("parseHookInput", () => {
  it("reads a Claude payload", () => {
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
    expect(input?.tool_input).toEqual({ file_path: "/repo/a.ts" });
    expect(input?.agent_type).toBe("scout");
  });

  it("reads spawn markers on a nested agent object", () => {
    const input = parseHookInput(JSON.stringify({ agent: { spawnedBy: "p1", spawned_by: "p2", id: 7 } }));
    expect(input?.agent).toEqual({ spawnedBy: "p1", spawned_by: "p2" });
  });

  it("reads the Claude worktree fields", () => {
    const create = parseHookInput(JSON.stringify({ hook_event_name: "WorktreeCreate", name: "feat", cwd: "/repo" }));
    expect(create?.name).toBe("feat");
    const remove = parseHookInput(JSON.stringify({ hook_event_name: "WorktreeRemove", worktree_path: "/repo/.worktrees/feat", name: 3 }));
    expect(remove?.worktree_path).toBe("/repo/.worktrees/feat");
    expect(remove?.name).toBeUndefined();
  });

  it("reads a Codex payload", () => {
    const input = parseHookInput(
      JSON.stringify({ session_id: "s2", turn_id: "t1", model: "gpt", tool_name: "Bash", tool_input: { command: "ls" } }),
    );
    expect(input?.turn_id).toBe("t1");
    expect(input?.model).toBe("gpt");
    expect(input?.tool_input).toEqual({ command: "ls" });
  });

  it("reads a Cursor payload", () => {
    const input = parseHookInput(
      JSON.stringify({ conversationId: "c1", cursor_version: "1.0", hookEventName: "preToolUse", toolName: "Shell", toolInput: { command: "ls", cwd: "/r" } }),
    );
    expect(input?.cursor_version).toBe("1.0");
    expect(input?.conversationId).toBe("c1");
    expect(input?.toolInput).toEqual({ command: "ls", cwd: "/r" });
  });

  it("reads a Grok payload", () => {
    const input = parseHookInput(
      JSON.stringify({ sessionId: "g1", agent: { type: "scout" }, lastAssistantMessage: "done", stopHookActive: false }),
    );
    expect(input?.sessionId).toBe("g1");
    expect(input?.agent).toEqual({ type: "scout" });
    expect(input?.lastAssistantMessage).toBe("done");
  });

  it("reads the workspace fields and keeps only string paths", () => {
    const input = parseHookInput(
      JSON.stringify({ workspaceRoot: "/a", workspace_root: "/b", workspacePaths: ["/c", 3, null, "/d"] }),
    );
    expect(input?.workspaceRoot).toBe("/a");
    expect(input?.workspace_root).toBe("/b");
    expect(input?.workspacePaths).toEqual(["/c", "/d"]);
  });

  it("drops workspace fields of the wrong type", () => {
    const input = parseHookInput(JSON.stringify({ workspaceRoot: 1, workspace_root: {}, workspacePaths: "/x" }));
    expect(input).toEqual({});
  });

  it("returns null for invalid JSON", () => {
    expect(parseHookInput("{nope")).toBeNull();
    expect(parseHookInput("")).toBeNull();
  });

  it("returns null for a non-object", () => {
    expect(parseHookInput("null")).toBeNull();
    expect(parseHookInput("[1]")).toBeNull();
    expect(parseHookInput('"x"')).toBeNull();
    expect(parseHookInput("3")).toBeNull();
  });

  it("drops a wrong-typed field and keeps the rest", () => {
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
    expect(input).toEqual({ session_id: "s1", stopHookActive: true });
  });

  it("keeps only well-typed parts of toolCall and agent", () => {
    expect(parseHookInput(JSON.stringify({ toolCall: { name: 1, args: [] }, agent: { type: "scout", id: 2, name: "n" } }))).toEqual({
      toolCall: {},
      agent: { type: "scout", name: "n" },
    });
    expect(parseHookInput(JSON.stringify({ toolCall: { name: "Read", args: { a: 1 } }, agent: "scout" }))).toEqual({
      toolCall: { name: "Read", args: { a: 1 } },
      agent: "scout",
    });
    expect(parseHookInput(JSON.stringify({ toolCall: "x", agent: 3 }))).toEqual({});
  });
});
