import { expect, it } from "vitest";

import { CURSOR_VERSION } from "./__fixtures__/hook-payload.ts";
import { harnessOf } from "./gate-harness.ts";
import { parseHookInput } from "./hook-input.ts";

it("detects a string cursor_version before every other shape", () => {
  expect(harnessOf({ cursor_version: CURSOR_VERSION, tool_name: "Shell" })).toBe("cursor");
  expect(harnessOf({ cursor_version: CURSOR_VERSION, model: "m", turn_id: "t" })).toBe("cursor");
  expect(harnessOf({ cursor_version: CURSOR_VERSION, toolCall: { args: {}, name: "x" } })).toBe("cursor");
  // The wire parse drops a cursor_version that is not a string, so the payload reads as Claude's.
  expect(harnessOf(parseHookInput('{"cursor_version":3,"model":"m"}') ?? {})).toBe("claude");
  expect(harnessOf({ model: "m", session_id: "s" })).toBe("claude");
});
