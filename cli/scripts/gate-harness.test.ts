import { expect, it } from "vitest";
import { harnessOf } from "./gate-harness.ts";
import { CURSOR_VERSION, parsedPayload } from "./fixtures/hook-payload.ts";

it("detects a string cursor_version before every other shape", () => {
  expect(harnessOf({ cursor_version: CURSOR_VERSION, tool_name: "Shell" })).toBe("cursor");
  expect(harnessOf({ cursor_version: CURSOR_VERSION, turn_id: "t", model: "m" })).toBe("cursor");
  expect(harnessOf({ cursor_version: CURSOR_VERSION, toolCall: { name: "x", args: {} } })).toBe("cursor");
  expect(harnessOf(parsedPayload('{"cursor_version":3,"model":"m"}'))).toBe("claude");
  expect(harnessOf({ session_id: "s", model: "m" })).toBe("claude");
});
