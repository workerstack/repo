// Live payloads from `claude -p`, `codex exec`, `grok -p`, `agy -p` and `cursor-agent -p` (phase 6 probe, 2026-11-07),
// trimmed to the keys that matter. Each case is a parent write and the write of a spawned `scout`.
import path from "node:path";

import { expect, it } from "vitest";

import { useTmp } from "./fixtures/gate-workspace.ts";
import { denyReason, inSession, kindWrite } from "./fixtures/hook-payload.ts";
import { planFile, reviewReason } from "./fixtures/review-plan.ts";
import { isParentOrchestrator, sessionIdOf, subagentTypeOf } from "./gate-agents.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import { harnessOf } from "./gate-harness.ts";
import type { HookInput } from "./hook-input.ts";
import { ENFORCED_HARNESSES, writeStamp } from "./strategy.ts";

interface Captured {
  parent: (file: string) => HookInput;
  child: (file: string) => HookInput;
  sid: [string, string];
}

const tool = (file: string) => ({ content: "x\n", file_path: file });
const patch = (file: string) => `*** Begin Patch\n*** Add File: ${file}\n+x\n*** End Patch`;
const tmp = useTmp();

const claude: Captured = {
  child: (f) => ({
    agent_id: "a6992087d63505a23",
    agent_type: "scout",
    hook_event_name: "PreToolUse",
    session_id: "6300f867",
    tool_input: tool(f),
    tool_name: "Write",
  }),
  parent: (f) => ({ hook_event_name: "PreToolUse", session_id: "6300f867", tool_input: tool(f), tool_name: "Write" }),
  sid: ["6300f867", "6300f867"],
};
const codex: Captured = {
  child: (f) => ({
    agent_id: "01a1b75e-29a2",
    agent_type: "scout",
    hook_event_name: "PreToolUse",
    model: "gpt-6-luna",
    session_id: "01a1b75e-14b3",
    tool_input: { command: patch(f) },
    tool_name: "apply_patch",
    turn_id: "01a1b75e-29af",
  }),
  parent: (f) => ({
    hook_event_name: "PreToolUse",
    model: "gpt-6-luna",
    session_id: "01a1b75e-14b3",
    tool_input: { command: patch(f) },
    tool_name: "apply_patch",
    turn_id: "01a1b75e-164b",
  }),
  sid: ["01a1b75e-14b3", "01a1b75e-14b3"],
};
// Grok's wire shape is Claude's: harnessOf says claude, so "claude" in ENFORCED_HARNESSES enforces Grok too.
const grok: Captured = {
  child: (f) => ({
    hookEventName: "pre_tool_use",
    hook_event_name: "PreToolUse",
    sessionId: "01a1b75f-2238",
    session_id: "01a1b75f-2238",
    subagentType: "scout",
    toolInput: tool(f),
    toolName: "write",
    tool_input: tool(f),
    tool_name: "write",
  }),
  parent: (f) => ({
    hookEventName: "pre_tool_use",
    hook_event_name: "PreToolUse",
    sessionId: "01a1b75e-d19d",
    session_id: "01a1b75e-d19d",
    toolInput: tool(f),
    toolName: "write",
    tool_input: tool(f),
    tool_name: "write",
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
    expect([sessionIdOf(parent), sessionIdOf(child)]).toStrictEqual(c.sid);
    expect([isParentOrchestrator(parent), subagentTypeOf(parent)]).toStrictEqual([true, ""]);
    expect([isParentOrchestrator(child), subagentTypeOf(child)]).toStrictEqual([false, "scout"]);
    expect(processFatTools({ ...parent, cwd: w })).toStrictEqual({ reason: reviewReason("review-fast"), type: "deny" });
    expect(processFatTools({ ...child, cwd: w })).toBeNull();
  },
);

it("Antigravity sends its session id only as conversationId, and its child carries no marker", () => {
  const parent = {
    conversationId: "d1398f48",
    modelName: "gemini-3.8-flash-high",
    stepIdx: 2,
    toolCall: { args: { Content: "parent\n", Path: "/w/parent.txt" }, name: "write_file" },
  };
  const child = {
    conversationId: "4ea12b55",
    modelName: "gemini-3.8-flash-tiered",
    stepIdx: 2,
    toolCall: { args: { CommandLine: "printf 'child\\n' > /w/child.txt" }, name: "run_command" },
  };
  expect([harnessOf(parent), harnessOf(child)]).toStrictEqual(["antigravity", "antigravity"]);
  expect([sessionIdOf(parent), sessionIdOf(child)]).toStrictEqual(["d1398f48", "4ea12b55"]);
  expect([isParentOrchestrator(parent), isParentOrchestrator(child)]).toStrictEqual([true, true]);
  expect([subagentTypeOf(parent), subagentTypeOf(child)]).toStrictEqual(["", ""]);
  expect(ENFORCED_HARNESSES.has("antigravity")).toBe(false);
  // A review is running for the parent's conversation; an unenforced harness is still let through.
  const w = tmp.dir("gate-captured-");
  writeStamp(w, "d1398f48", planFile(w, "review-fast").file);
  const product = path.join(w, "src/x.ts");
  const args = { Content: "x", Path: product };
  const write = { ...parent, toolCall: { args, name: "write_file" }, workspacePaths: [w] };
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
    cursor_version: "2026.11.05-86047df",
    hook_event_name: "preToolUse",
    model: "default",
    session_id: "4fc450b7",
    tool_input: tool("/w/parent.txt"),
    tool_name: "Write",
  };
  const child = { ...parent, conversation_id: "26bb97fb", session_id: "26bb97fb", tool_input: tool("/w/child.txt") };
  expect([harnessOf(parent), harnessOf(child)]).toStrictEqual(["cursor", "cursor"]);
  expect([isParentOrchestrator(parent), isParentOrchestrator(child)]).toStrictEqual([true, true]);
  expect(ENFORCED_HARNESSES.has("cursor")).toBe(false);
});
