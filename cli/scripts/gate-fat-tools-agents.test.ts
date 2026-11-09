import { describe, expect, it } from "vitest";
import type { HookInput } from "./hook-input.ts";
import {
  eventKey,
  hasChildAgentMarker,
  isParentOrchestrator,
  sessionIdOf,
  subagentTypeOf,
  toolCallOf,
} from "./gate-fat-tools.ts";

describe("eventKey", () => {
  it("lowercases and drops punctuation, and reads an absent name as empty", () => {
    expect(eventKey("Run_Terminal-Command")).toBe("runterminalcommand");
    expect(eventKey(undefined)).toBe("");
    expect(eventKey("")).toBe("");
  });
});

describe("hasChildAgentMarker", () => {
  it("is false for a payload that is not an object", () => {
    expect(hasChildAgentMarker(null)).toBe(false);
    expect(hasChildAgentMarker(undefined)).toBe(false);
    expect(hasChildAgentMarker("agent" /* a scalar payload the host should never send */ as never)).toBe(false);
  });

  it("reads a child id from the payload or from the agent object", () => {
    expect(hasChildAgentMarker({ agent_id: "a1" })).toBe(true);
    expect(hasChildAgentMarker({ agentId: "  " })).toBe(false);
    expect(hasChildAgentMarker({ agent: { id: "a1" } })).toBe(true);
    expect(hasChildAgentMarker({ agent: { spawned_by: "p1" } })).toBe(true);
    expect(hasChildAgentMarker({ agent: { type: "scout" } })).toBe(false);
    expect(hasChildAgentMarker({ agent: {} })).toBe(false);
  });

  it("ignores an agent that is a list or a string", () => {
    expect(hasChildAgentMarker({ agent: ["a1"] /* a list where an object belongs */ as never })).toBe(false);
    expect(hasChildAgentMarker({ agent: "a1" /* a string where an object belongs */ as never })).toBe(false);
  });
});

describe("subagentTypeOf", () => {
  it("is empty for a payload that is not an object", () => {
    expect(subagentTypeOf(null)).toBe("");
    expect(subagentTypeOf(undefined)).toBe("");
    expect(subagentTypeOf("scout" /* a scalar payload the host should never send */ as never)).toBe("");
  });

  it("lowercases a type and skips values that are not a type", () => {
    expect(subagentTypeOf({ subagent_type: "Scout" })).toBe("scout");
    const skipped = ["   ", "12345", "0a1b2c3d-0a1b-0a1b-0a1b-0a1b2c3d4e5f", "a/b", "a\\b", "x".repeat(65)];
    for (const value of skipped) expect(subagentTypeOf({ subagent_type: value })).toBe("");
    expect(subagentTypeOf({ subagent_type: "x".repeat(64) })).toBe("x".repeat(64));
  });
});

describe("subagentTypeOf agent shapes", () => {
  it("reads the type from the agent object or a bare agent string", () => {
    expect(subagentTypeOf({ agent: { name: "Reviewer" } })).toBe("reviewer");
    expect(subagentTypeOf({ agent: { type: "" } })).toBe("");
    expect(subagentTypeOf({ agent: "Scout" /* Antigravity-style bare string */ as never })).toBe("scout");
    expect(subagentTypeOf({ agent: "  " /* a blank bare string */ as never })).toBe("");
    expect(subagentTypeOf({ agent: ["scout"] /* a list where an object belongs */ as never })).toBe("");
    expect(subagentTypeOf({})).toBe("");
  });

  it("makes a payload with a child marker or type a child", () => {
    expect(isParentOrchestrator({ agent: { id: "a1" } })).toBe(false);
    expect(isParentOrchestrator({ agent: {} })).toBe(true);
  });
});

describe("toolCallOf and sessionIdOf", () => {
  it("returns no args when the input is not an object", () => {
    const data: HookInput = { tool_name: "Bash", tool_input: "ls" /* a string where an object belongs */ as never };
    expect(toolCallOf(data)).toEqual({ harness: "claude", key: "bash", args: null });
    expect(toolCallOf({ toolName: "Bash", toolInput: { command: "ls" } }).args).toEqual({ command: "ls" });
  });

  it("reads the session id from any host spelling and drops the default one", () => {
    expect(sessionIdOf({ conversationId: " c1 " })).toBe("c1");
    expect(sessionIdOf({ session_id: "default" })).toBe("");
    expect(sessionIdOf(null)).toBe("");
  });
});
