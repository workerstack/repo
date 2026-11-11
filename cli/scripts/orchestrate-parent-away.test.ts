import fs from "node:fs";

import { expect, it } from "vitest";

import { closingLine } from "./closing-line.ts";
import { hookSession, type HookSession, type Shape } from "./fixtures/hook-session.ts";
import { orchestrateKit } from "./fixtures/orchestrate-kit.ts";
import { VALID_PLAN } from "./fixtures/persist-bodies.ts";
import { ASK_STOP_REASON } from "./orchestrate.constants.ts";

const kit = orchestrateKit();
const SHAPES: readonly Shape[] = ["claude", "grok"];
// Roots and session come from the payload alone, as in a live session.
const UNSET = { CLAUDE_PROJECT_DIR: "", GROK_HOOK_EVENT: "", GROK_SESSION_ID: "", GROK_WORKSPACE_ROOT: "" };
const AWAY =
  'away: do not ask; decide, log "- decision: {question} → {choice}, because {why}" in the plan, and continue';
const plan1 = closingLine([{ kind: "plan", serial: 1, strategy: "default" }]);
const live = (shape: Shape, ws: string, sid: string): HookSession => hookSession(kit, { env: UNSET, shape, sid, ws });
const setKey = (file: string, key: string, value: string) =>
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(new RegExp(`^${key}: .*$`, "m"), `${key}: ${value}`));
const withMode = (mode: string) => VALID_PLAN.replace("strategy: default", `strategy: default\nmode: ${mode}`);

it.each(SHAPES)("/away gives sessionGate=away, then /auto gives sessionGate=auto (%s payloads)", (shape) => {
  const s = live(shape, kit.temp(), "a1");
  expect(s.say("/away")).toMatch(/^sessionGate=away\b/);
  expect(s.say("go on")).toMatch(/^sessionGate=away\b/);
  expect(s.say("/auto")).toMatch(/^sessionGate=auto\b/);
});

it.each(SHAPES)("an in-progress mode: ask plan this session saved wins over /away (%s payloads)", (shape) => {
  const s = live(shape, kit.temp(), "m1");
  s.say("/away");
  setKey(s.reviewed("plans", withMode("ask")), "status", "in-progress");
  expect(s.say("go")).toMatch(/^sessionGate=ask\b/);
  expect(s.stop("wrote src/a.ts")?.reason).toBe(ASK_STOP_REASON);
  expect(s.stop("Keep --json?")).toBeNull();
});

it.each(SHAPES)("another session's mode: away plan leaves this session's mode alone (%s payloads)", (shape) => {
  const ws = kit.temp();
  setKey(live(shape, ws, "other").reviewed("plans", withMode("away")), "status", "in-progress");
  const s = live(shape, ws, "m2");
  expect(s.say("go")).toMatch(/^sessionGate=auto\b/);
  expect(s.stop("Keep --json?")).toBeNull();
  expect(s.say("/ask")).toMatch(/^sessionGate=ask\b/);
  expect(s.stop("wrote src/a.ts")?.reason).toBe(ASK_STOP_REASON);
});

it.each(SHAPES)(
  "away blocks a reply ending in a question, allows a closing line, and gives up after the stop-block cap (%s payloads)",
  (shape) => {
    const s = live(shape, kit.temp(), "w1");
    s.say("/away");
    expect(s.stop("Two options.\n\nKeep --json or add --format=json?\n")).toStrictEqual({
      decision: "block",
      reason: AWAY,
    });
    expect(s.stop("Is it done? Yes.\nwrote src/a.ts")).toBeNull();
    expect(s.stop("Keep --json?")?.reason).toBe(AWAY);
    expect(s.stop("Keep --json?")?.reason).toBe(AWAY);
    expect(s.stop("Keep --json?")).toBeNull();
    s.say("plan it");
    s.reviewed("plans", VALID_PLAN);
    expect(s.stop(`Saved.\n\n${plan1}`)).toBeNull();
  },
);

it.each(SHAPES)("a review spawn holds the closing line until the plan's reviews is bumped (%s payloads)", (shape) => {
  const s = live(shape, kit.temp(), "r1");
  s.say("plan it");
  const plan = s.reviewed("plans", VALID_PLAN);
  s.spawnReview("/review-plan 1\n\nReview it.");
  const reason =
    "plan 1's review has not settled; wait for it, settle its findings with reviews bumped, then end with the closing line";
  expect(s.stop(`Saved.\n\n${plan1}`)).toStrictEqual({ decision: "block", reason });
  setKey(plan, "reviews", "2");
  expect(s.stop(`Saved.\n\n${plan1}`)).toBeNull();
});

it.each(SHAPES)("a closing line naming a plan with reviews: 0 blocks (%s payloads)", (shape) => {
  const s = live(shape, kit.temp(), "z1");
  s.say("plan it");
  s.save(".tmp/repo/plans/x.md", VALID_PLAN);
  expect(s.stop(`Saved.\n\n${plan1}`)).toStrictEqual({
    decision: "block",
    reason: "plan 1 has reviews: 0; run /review-plan 1 in a fresh agent first",
  });
});
