import { expect, it } from "vitest";

import type { Json } from "../json.ts";
import { hookSession } from "./__fixtures__/hook-session.ts";
import { orchestrateKit, plan as planItem, replyOf, roadmap } from "./__fixtures__/orchestrate-kit.ts";
import { clicked } from "./__fixtures__/picker-kit.ts";
import { PLAN } from "./__fixtures__/save-strategy-kit.ts";
import { pickerInput } from "./approval-picker.ts";

const kit = orchestrateKit();

/** One PostToolUse of `name` in session `sid`, sent as Claude Code sends it; the context it adds, "" when none. */
function post(at: { ws: string; sid: string }, input: Json, name = "AskUserQuestion"): string {
  const payload = {
    cwd: at.ws,
    hook_event_name: "PostToolUse",
    session_id: at.sid,
    tool_input: input,
    tool_name: name,
  };

  return replyOf(kit.run(payload, { CLAUDE_PROJECT_DIR: at.ws }))?.hookSpecificOutput.additionalContext ?? "";
}

/** A Claude session with one reviewed plan waiting; where to send its events. */
function waiting(sid: string) {
  const ws = kit.temp();
  const s = hookSession(kit, { casing: "claude", env: { CLAUDE_PROJECT_DIR: ws }, sid, ws });
  s.say("plan it");
  s.reviewed("plans", PLAN);

  return { sid, ws };
}

it("feedback on a queue names every item and every review to run again", () => {
  const at = waiting("e1");
  const queue = [planItem(1, "spawn-fast"), roadmap(2, "free")];

  expect(post(at, clicked(queue, { approval: "shorter" }))).toBe(
    '"shorter" is feedback on plan 1, then roadmap 2: revise each, ' +
      "run /review-plan 1 and /review-roadmap 2 again, then stop for approval again",
  );
});

it("a click on a picker whose items no longer wait adds no context", () => {
  const at = waiting("e2");

  expect(post(at, clicked([planItem(9, "free")], { approval: "Implement" }))).toBe("");
});

it("a PostToolUse that names no tool adds no context", () => {
  const at = waiting("e3");

  expect(post(at, pickerInput([planItem(1)]), "")).toBe("");
});
