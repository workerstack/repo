import { describe, expect, it } from "vitest";
import { hasChildAgentMarker, isImplementer, isParentOrchestrator, subagentTypeOf } from "./gate-agents.ts";

const CHILD_UUID = "b2c6f0d4-0000-4000-8000-000000000000";

describe("isParentOrchestrator", () => {
  it("is true when subagent type is absent, false when set", () => {
    expect(isParentOrchestrator({})).toBe(true);
    expect(isParentOrchestrator({ toolName: "grep" })).toBe(true);
    expect(isParentOrchestrator({ subagentType: "explore" })).toBe(false);
    expect(isParentOrchestrator({ subagent_type: "thinker" })).toBe(false);
    expect(isParentOrchestrator({ agentType: "scout" })).toBe(false);
    expect(isParentOrchestrator({ agent_type: "explore" })).toBe(false);
    expect(isParentOrchestrator({ agentId: "explore" })).toBe(false);
    expect(isParentOrchestrator({ agent_id: "thinker" })).toBe(false);
    expect(isParentOrchestrator({ spawnedBy: "repo" })).toBe(false);
    expect(isParentOrchestrator({ spawned_by: "explore" })).toBe(false);
    expect(isParentOrchestrator({ agentId: CHILD_UUID })).toBe(false);
    expect(hasChildAgentMarker({ agentId: CHILD_UUID })).toBe(true);
    expect(hasChildAgentMarker({})).toBe(false);
    expect(isParentOrchestrator({ agent: { type: "explore" } })).toBe(false);
    expect(subagentTypeOf({ agent_id: "explore" })).toBe("explore");
    expect(subagentTypeOf({ agentId: CHILD_UUID })).toBe("");
  });
});

describe("isImplementer", () => {
  it("names the implementer-* children only", () => {
    expect(["implementer-fast", "implementer-deep", "implementer-x"].map(isImplementer)).toEqual([true, true, true]);
    expect(["", "scout", "implementer", "orchestrator", "my-implementer-fast"].map(isImplementer)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
