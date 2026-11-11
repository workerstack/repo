// The gate's answer to a camelCase call, and the rewrite answer the suites expect; the deny is in ./checkout-calls.ts.
import { processFatTools } from "../gate-fat-tools.ts";
import type { GateResult, ToolArgs } from "../gate-harness.ts";
import type { HookInput } from "../hook-input.ts";
import { camelCall } from "./hook-payload.ts";

/** What the gate answers to `tool` called with `input`, plus any `extra` payload fields. */
export function gated(tool: string, input: ToolArgs, extra: HookInput = {}): GateResult {
  return processFatTools(camelCall(tool, input, extra));
}

/** A gate answer that rewrites the call's input to `updatedInput`. */
export function rewrite(updatedInput: ToolArgs) {
  return { type: "rewrite", updatedInput };
}
