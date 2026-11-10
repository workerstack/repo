// Live payloads from `claude -p`, `codex exec`, `grok -p`, `agy -p` and `cursor-agent -p` (phase 6 probe, 2026-11-07),
// trimmed to the keys that matter. Each case is a parent write and the write of a spawned `scout`.
import path from "node:path";
import { expect, it } from "vitest";
import { isParentOrchestrator, sessionIdOf, subagentTypeOf } from "./gate-agents.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import { harnessOf } from "./gate-harness.ts";
import { ENFORCED_HARNESSES, writeStamp } from "./strategy.ts";
import type { HookInput } from "./hook-input.ts";
import { denyReason, inSession, kindWrite } from "./fixtures/hook-payload.ts";
import { useTmp } from "./fixtures/gate-workspace.ts";
import { planFile, reviewReason } from "./fixtures/review-plan.ts";

interface Captured {
  parent: (file: string) => HookInput;
  child: (file: string) => HookInput;
  sid: [string, string];
}

const tool = (file: string) => ({ file_path: file, content: "x\n" });
const patch = (file: string) => `*** Begin Patch\n*** Add File: ${file}\n+x\n*** End Patch`;
const tmp = useTmp();

const claude: Captured = {
  parent: (f) => ({ session_id: "6300f867", hook_event_name: "PreToolUse", tool_name: "Write", tool_input: tool(f) }),
  child: (f) => ({
    session_id: "6300f867",
    agent_id: "a6992087d63505a23",
    agent_type: "scout",
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: tool(f),
  }),
  sid: ["6300f867", "6300f867"],
};
const codex: Captured = {
  parent: (f) => ({
    session_id: "01a1b75e-14b3",
    turn_id: "01a1b75e-164b",
    hook_event_name: "PreToolUse",
    model: "gpt-6-luna",
    tool_name: "apply_patch",
    tool_input: { command: patch(f) },
  }),
  child: (f) => ({
    session_id: "01a1b75e-14b3",
    turn_id: "01a1b75e-29af",
    agent_id: "01a1b75e-29a2",
    agent_type: "scout",
    hook_event_name: "PreToolUse",
    model: "gpt-6-luna",
    tool_name: "apply_patch",
    tool_input: { command: patch(f) },
  }),
  sid: ["01a1b75e-14b3", "01a1b75e-14b3"],
};
// Grok's wire shape is Claude's: harnessOf says claude, so "claude" in ENFORCED_HARNESSES enforces Grok too.
const grok: Captured = {
  parent: (f) => ({
    hookEventName: "pre_tool_use",
    sessionId: "01a1b75e-d19d",
    toolName: "write",
    toolInput: tool(f),
    hook_event_name: "PreToolUse",
    session_id: "01a1b75e-d19d",
    tool_name: "write",
    tool_input: tool(f),
  }),
  child: (f) => ({
    hookEventName: "pre_tool_use",
    sessionId: "01a1b75f-2238",
    toolName: "write",
    toolInput: tool(f),
    subagentType: "scout",
    hook_event_name: "PreToolUse",
    session_id: "01a1b75f-2238",
    tool_name: "write",
    tool_input: tool(f),
  }),
  sid: ["01a1b75e-d19d", "01a1b75f-2238"],
};

it.each([
  ["claude", claude],
  ["codex", codex],
  ["grok", grok],
] as const)(
  "%s: the child carries a marker the gate reads, so the parent is denied and the child is not",
  (name, c) => {
    const w = tmp.dir("gate-captured-");
    writeStamp(w, c.sid[0], planFile(w, "review-fast").file);
    const parent = c.parent(path.join(w, "src/x.ts"));
    const child = c.child(path.join(w, "src/x.ts"));
    expect(harnessOf(parent)).toBe(name === "codex" ? "codex" : "claude");
    expect(harnessOf(child)).toBe(harnessOf(parent));
    expect(ENFORCED_HARNESSES.has(harnessOf(parent))).toBe(true);
    expect([sessionIdOf(parent), sessionIdOf(child)]).toEqual(c.sid);
    expect([isParentOrchestrator(parent), subagentTypeOf(parent)]).toEqual([true, ""]);
    expect([isParentOrchestrator(child), subagentTypeOf(child)]).toEqual([false, "scout"]);
    expect(processFatTools({ ...parent, cwd: w })).toEqual({ type: "deny", reason: reviewReason("review-fast") });
    expect(processFatTools({ ...child, cwd: w })).toBeNull();
  },
);

it("Antigravity sends its session id only as conversationId, and its child carries no marker", () => {
  const parent = {
    conversationId: "d1398f48",
    modelName: "gemini-3.8-flash-high",
    stepIdx: 2,
    toolCall: { name: "write_file", args: { Path: "/w/parent.txt", Content: "parent\n" } },
  };
  const child = {
    conversationId: "4ea12b55",
    modelName: "gemini-3.8-flash-tiered",
    stepIdx: 2,
    toolCall: { name: "run_command", args: { CommandLine: "printf 'child\\n' > /w/child.txt" } },
  };
  expect([harnessOf(parent), harnessOf(child)]).toEqual(["antigravity", "antigravity"]);
  expect([sessionIdOf(parent), sessionIdOf(child)]).toEqual(["d1398f48", "4ea12b55"]);
  expect([isParentOrchestrator(parent), isParentOrchestrator(child)]).toEqual([true, true]);
  expect([subagentTypeOf(parent), subagentTypeOf(child)]).toEqual(["", ""]);
  expect(ENFORCED_HARNESSES.has("antigravity")).toBe(false);
  // A review is running for the parent's conversation; an unenforced harness is still let through.
  const w = tmp.dir("gate-captured-");
  writeStamp(w, "d1398f48", planFile(w, "review-fast").file);
  const product = path.join(w, "src/x.ts");
  const args = { Path: product, Content: "x" };
  const write = { ...parent, workspacePaths: [w], toolCall: { name: "write_file", args } };
  expect(processFatTools(write)).toBeNull();
  expect(processFatTools(inSession(kindWrite("antigravity", { cwd: w, target: product }), "d1398f48"))).toBeNull();
});

it("Antigravity's edit in a committed repo is denied by the main-checkout guard though it is not enforced", () => {
  const w = tmp.committed("gate-captured-");
  writeStamp(w, "d1398f48", planFile(w, "review-fast").file);
  const put = (target: string) => inSession(kindWrite("antigravity", { cwd: w, target }), "d1398f48");
  const out = processFatTools(put(path.join(w, "src/x.ts")));
  expect(out?.type).toBe("deny");
  expect(denyReason(out)).toMatch(/^the main checkout is shared: run bun /);
  expect(processFatTools(put(path.join(w, ".worktrees/a/src/x.ts")))).toBeNull();
});

it("Cursor's child has its own session id and no marker", () => {
  const parent = {
    conversation_id: "4fc450b7",
    session_id: "4fc450b7",
    model: "default",
    tool_name: "Write",
    tool_input: tool("/w/parent.txt"),
    hook_event_name: "preToolUse",
    cursor_version: "2026.11.05-86047df",
  };
  const child = { ...parent, conversation_id: "26bb97fb", session_id: "26bb97fb", tool_input: tool("/w/child.txt") };
  expect([harnessOf(parent), harnessOf(child)]).toEqual(["cursor", "cursor"]);
  expect([isParentOrchestrator(parent), isParentOrchestrator(child)]).toEqual([true, true]);
  expect(ENFORCED_HARNESSES.has("cursor")).toBe(false);
});
