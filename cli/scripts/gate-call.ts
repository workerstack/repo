import type { GateResult, Harness, ToolArgs, ToolSpec } from "./gate-harness.ts";
/** The shape every guard step reads and answers in. */
import type { HookInput } from "./hook-input.ts";
import type { Roots } from "./workspace-root.ts";

/**
 * One guard step's answer: `undefined` passes the call to the next guard, `null` stops with no answer, and an
 * object is the gate's answer.
 */
export type GuardResult = GateResult | undefined;

/** One tool call as every guard reads it: who sent it, what it names, and where it runs. */
export interface GateCall {
  data: HookInput;
  harness: Harness;
  tool: ToolSpec;
  input: ToolArgs;
  roots: Roots;
  sid: string;
  /** The input field that holds the command, "" for a tool with none. */
  field: string;
  text: string;
  patch: string | null;
  shellCwd: string;
  /** The child agent type, "" for a parent. */
  sub: string;
  parent: boolean;
}
