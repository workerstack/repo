import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import type { Json } from "../json.ts";
import { modeSession } from "./__fixtures__/away-run-kit.ts";
import { hookSession } from "./__fixtures__/hook-session.ts";
import {
  closing,
  fastPlan,
  orchestrateKit,
  parseJson,
  plan as planItem,
  replyOf,
  strategyOf,
} from "./__fixtures__/orchestrate-kit.ts";
import { VALID_PLAN } from "./__fixtures__/persist-bodies.ts";
import { askReason, clicked } from "./__fixtures__/picker-kit.ts";
import { ADVICE, PLAN } from "./__fixtures__/save-strategy-kit.ts";
import { pickerInput } from "./approval-picker.ts";

const kit = orchestrateKit();

const SAVED = ADVICE.replace("advice: ", "");
const DENY_LEAD = "the approval picker must be exactly this input:";
const ONE_QUESTION = { header: "Pick", multiSelect: false, options: [], question: "Which one?" };

/** A Claude session with one reviewed plan that holds spawn-fast and advice. */
function onePlan(sid: string) {
  const ws = kit.temp();
  const s = hookSession(kit, { casing: "claude", env: { CLAUDE_PROJECT_DIR: ws }, sid, ws });
  s.say("/set spawn-fast");
  s.say("plan it");

  return { item: planItem(1, "spawn-fast", SAVED), plan: s.reviewed("plans", PLAN), s, ws };
}

type At = { ws: string; sid: string };

/** One tool event of session `at`, sent as Claude Code sends it; the reply, or null when the hook stays silent. */
function tool(at: At, call: { event: "PreToolUse" | "PostToolUse"; name: string; input: Json }) {
  const payload = {
    cwd: at.ws,
    hook_event_name: call.event,
    session_id: at.sid,
    tool_input: call.input,
    tool_name: call.name,
    tool_response: call.input,
    tool_use_id: "toolu_1",
  };

  return replyOf(kit.run(payload, { CLAUDE_PROJECT_DIR: at.ws }));
}

function pre(at: At, input: Json) {
  return tool(at, { event: "PreToolUse", input, name: "AskUserQuestion" });
}

function post(at: At, input: Json) {
  return tool(at, { event: "PostToolUse", input, name: "AskUserQuestion" });
}

/** The context a PostToolUse reply adds; "" when the hook stays silent. */
function contextOf(out: ReturnType<typeof tool>): string {
  return out?.hookSpecificOutput.additionalContext ?? "";
}

function stored(ws: string, sid: string): string | undefined {
  const file = path.join(ws, ".repo/tmp/sessions", sid, "settings.json");

  return parseJson<{ strategy?: string }>(fs.readFileSync(file, "utf8")).strategy;
}

function typed(...items: Parameters<typeof closing>): string {
  return `end with this block:\n${closing(...items)}`;
}

it("a Claude Stop asks for the picker, the JSON and then the typed block", () => {
  const { s } = onePlan("p1");

  const approval =
    '{"question":"plan 1 · spawn-fast: implement it here, or hand it off?","header":"Approval","multiSelect":false,' +
    '"options":[{"label":"Implement","description":"run it in this session"},' +
    '{"label":"Hand off","description":"write a handoff to run in a fresh session"}]}';

  const strategy =
    '{"question":"Which strategy?","header":"Strategy","multiSelect":false,"options":[' +
    '{"label":"spawn-fast","description":"saved in the file"},' +
    '{"label":"spawn-deep","description":"advice: the hook and gate change together"},' +
    '{"label":"free","description":"this session does every phase itself"}]}';

  const json = `{"questions":[${approval},${strategy}]}`;

  const line =
    "call AskUserQuestion with exactly this input, then act on the answer; " +
    "with no AskUserQuestion tool, end with this block:";

  expect(s.stop("Saved.")).toStrictEqual({
    decision: "block",
    reason: `${line}\n${json}\n${closing(planItem(1, "spawn-fast", SAVED))}`,
  });
});

it("a Claude Stop that ends with the right typed block still gets the picker reason, and the next Stop passes", () => {
  const { item, s } = onePlan("p1b");

  expect(s.stop(`Saved.\n\n${closing(item)}`)?.reason).toBe(askReason(item));
  expect(s.stop(`Saved.\n\n${closing(item)}`)).toBeNull();
});

it("a Codex Stop keeps the typed block", () => {
  const { item, ws } = onePlan("p2");

  const codex = {
    cwd: ws,
    hook_event_name: "Stop",
    last_assistant_message: "Saved.",
    model: "gpt-5",
    session_id: "p2",
    turn_id: "t1",
  };

  expect(replyOf(kit.run(codex, { CLAUDE_PROJECT_DIR: ws }))?.reason).toBe(typed(item));
});

it("a Stop under a Grok event keeps the typed block", () => {
  const { item, ws } = onePlan("p2g");
  const env = { CLAUDE_PROJECT_DIR: ws, GROK_HOOK_EVENT: "stop" };
  const out = JSON.stringify(hookSession(kit, { casing: "claude", env, sid: "p2g", ws }).stop("Saved."));

  expect(out).toContain(JSON.stringify(typed(item)).slice(1, -1));
  expect(out).not.toContain("AskUserQuestion");
});

it("a Claude Stop under away that cannot run the plan keeps the typed block", () => {
  const { s } = modeSession(kit, "p3", "/away");
  const plan = s.reviewed("plans", VALID_PLAN);
  fs.writeFileSync(plan, fs.readFileSync(plan, "utf8").replace("## Verify", "## Checks"));

  expect(s.stop("Saved.")).toStrictEqual({ decision: "block", reason: typed(planItem(1)) });
});

it("PreToolUse lets the rendered picker and an unrelated picker through", () => {
  const { item, ws } = onePlan("p4");
  const at = { sid: "p4", ws };

  for (const input of [pickerInput([item]), { questions: [ONE_QUESTION] }])
    expect(pre(at, input)?.hookSpecificOutput.permissionDecision).not.toBe("deny");
});

it("PreToolUse denies an approval picker that differs from the rendered one, with the rendered input", () => {
  const { item, ws } = onePlan("p5");
  const rendered = pickerInput([item]);
  const changed = { questions: rendered.questions.map((q) => ({ ...q, options: q.options.slice(0, 1) })) };
  const out = pre({ sid: "p5", ws }, changed);

  expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(out?.hookSpecificOutput.permissionDecisionReason).toContain(`${DENY_LEAD}\n${JSON.stringify(rendered)}`);
});

it("PreToolUse denies an approval picker under away and tells the agent to end with the block", () => {
  const { s, ws } = modeSession(kit, "p6", "/away");
  s.reviewed("plans", VALID_PLAN);
  const out = pre({ sid: "p6", ws }, pickerInput([planItem(1)]));

  expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(out?.hookSpecificOutput.permissionDecisionReason).toBe(
    "under away the hook runs the approval block's header choice; end the reply with the approval block",
  );
});

it("PreToolUse denies an approval picker when nothing waits for approval", () => {
  const ws = kit.temp();
  const s = hookSession(kit, { casing: "claude", env: { CLAUDE_PROJECT_DIR: ws }, sid: "p7", ws });
  s.say("just talk");
  const out = pre({ sid: "p7", ws }, pickerInput([planItem(1)]));

  expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(out?.hookSpecificOutput.permissionDecisionReason).toBe("nothing waits for approval; ask no approval picker");
});

it("a click on Implement with the saved strategy approves the plan as a typed i would", () => {
  const { item, plan, ws } = onePlan("p8");
  const out = post({ sid: "p8", ws }, clicked([item], { approval: "Implement", strategy: "spawn-fast" }));

  expect(contextOf(out)).toContain(`i approves plan 1: plan 1: run /implement-plan-deep 1 (${plan})`);
  expect(contextOf(out)).not.toContain("set strategy");
  expect(strategyOf(plan)).toBe("spawn-fast");
});

it("a click on Implement with spawn-deep writes the plan and the session store", () => {
  const { item, plan, ws } = onePlan("p9");
  const out = post({ sid: "p9", ws }, clicked([item], { approval: "Implement", strategy: "spawn-deep" }));

  expect(contextOf(out)).toContain("i approves plan 1: plan 1: strategy spawn-deep was written to its frontmatter; ");
  expect(contextOf(out)).toContain("set strategy spawn-deep (was spawn-fast)");
  expect(strategyOf(plan)).toBe("spawn-deep");
  expect(stored(ws, "p9")).toBe("spawn-deep");
});

it("a click on Hand off writes the handoff and says to run /pickup in a fresh session", () => {
  const { item, ws } = onePlan("p10");
  const out = post({ sid: "p10", ws }, clicked([item], { approval: "Hand off", strategy: "spawn-fast" }));
  const dir = path.join(ws, ".repo/handoffs");

  expect(contextOf(out)).toMatch(
    /^h handed off plan 1 \(strategy spawn-fast\) to .+; tell the person to run \/pickup \d+ in a fresh session/,
  );
  expect(contextOf(out)).toContain("do no work here");
  expect(fs.readdirSync(dir)).toHaveLength(1);
});

it("a click on a plan whose review has not settled is refused and writes nothing", () => {
  const { item, plan, ws } = onePlan("p11");
  fs.writeFileSync(path.join(ws, ".repo/tmp/sessions/p11/reviews-open.json"), '{"plan 1":1}');
  const out = post({ sid: "p11", ws }, clicked([item], { approval: "Implement", strategy: "spawn-deep" }));

  expect(contextOf(out)).toContain("i did not approve plan 1: its review has not settled; ");
  expect(strategyOf(plan)).toBe("spawn-fast");
  expect(stored(ws, "p11")).toBe("spawn-fast");
});

it("a typed answer is feedback, and the next Stop asks for the picker again", () => {
  const { item, s, ws } = onePlan("p12");
  expect(s.stop(`Saved.\n\n${closing(item)}`)?.reason).toBe(askReason(item));
  const out = post({ sid: "p12", ws }, clicked([item], { approval: "make it shorter" }));

  expect(contextOf(out)).toBe(
    '"make it shorter" is feedback on plan 1: revise it, run /review-plan 1 again, then stop for approval again',
  );
  expect(s.stop("Revised.")?.reason).toBe(askReason(item));
});

it("a Task call and an unrelated picker answer add no context and change nothing", () => {
  const { plan, ws } = onePlan("p13");
  const at = { sid: "p13", ws };

  const task = { event: "PostToolUse", input: { description: "d", prompt: "p" }, name: "Task" } as const;

  expect(contextOf(tool(at, task))).toBe("");
  expect(contextOf(post(at, { answers: { "Which one?": "Beta" }, questions: [ONE_QUESTION] }))).toBe("");
  expect(strategyOf(plan)).toBe("spawn-fast");
});

it("feedback on a fast plan names no review to run again", () => {
  const ws = kit.temp();
  const out = post({ sid: "p14", ws }, clicked([fastPlan(1)], { approval: "shorter" }));

  expect(contextOf(out)).toBe('"shorter" is feedback on fast-plan 1: revise it, then stop for approval again');
});
