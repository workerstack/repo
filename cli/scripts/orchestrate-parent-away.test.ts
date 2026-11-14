import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { hookSession, type HookSession, type Casing } from "./__fixtures__/hook-session.ts";
import { closing, orchestrateKit, plan as planItem } from "./__fixtures__/orchestrate-kit.ts";
import { VALID_PLAN } from "./__fixtures__/persist-bodies.ts";
import { AWAY_RUN_REASON, SESSION_GATE_STAMP } from "./orchestrate.constants.ts";

const kit = orchestrateKit();
const CASINGS: readonly Casing[] = ["claude", "grok"];

// Roots and session come from the payload alone, as in a live session.
const UNSET = { CLAUDE_PROJECT_DIR: "", GROK_HOOK_EVENT: "", GROK_SESSION_ID: "", GROK_WORKSPACE_ROOT: "" };

const AWAY =
  'away: do not ask; decide, log "- decision: {question} → {choice}, because {why}" in the plan, and continue';

const plan1 = closing(planItem(1));

function live(casing: Casing, ws: string, sid: string): HookSession {
  return hookSession(kit, { casing, env: UNSET, sid, ws });
}

function setKey(file: string, key: string, value: string) {
  return fs.writeFileSync(
    file,
    fs.readFileSync(file, "utf8").replace(new RegExp(`^${key}: .*$`, "m"), `${key}: ${value}`),
  );
}

function withMode(mode: string) {
  return VALID_PLAN.replace("strategy: free", `strategy: free\nmode: ${mode}`);
}

it.each(CASINGS)("/away gives sessionGate=away, then /ask gives sessionGate=ask (%s payloads)", (casing) => {
  const s = live(casing, kit.temp(), "a1");
  expect(s.say("/away")).toMatch(/^sessionGate=away\b/);
  expect(s.say("go on")).toMatch(/^sessionGate=away\b/);
  expect(s.say("/ask")).toMatch(/^sessionGate=ask\b/);
});

it.each(CASINGS)("/away wins over an in-progress mode: ask plan this session saved (%s payloads)", (casing) => {
  const s = live(casing, kit.temp(), "m1");
  s.say("/away");
  setKey(s.reviewed("plans", withMode("ask")), "status", "in-progress");
  expect(s.say("go")).toMatch(/^sessionGate=away\b/);
  expect(s.stop("Keep --json?")).toStrictEqual({ decision: "block", reason: AWAY });
});

it.each(CASINGS)("an unstamped session's in-progress mode: away plan gives away (%s payloads)", (casing) => {
  const s = live(casing, kit.temp(), "m3");
  setKey(s.reviewed("plans", withMode("away")), "status", "in-progress");
  expect(s.say("go")).toMatch(/^sessionGate=away\b/);
  expect(s.stop("Keep --json?")?.reason).toBe(AWAY);
});

it.each(CASINGS)("/ask wins over an in-progress mode: away plan (%s payloads)", (casing) => {
  const s = live(casing, kit.temp(), "m4");
  setKey(s.reviewed("plans", withMode("away")), "status", "in-progress");
  expect(s.say("/ask")).toMatch(/^sessionGate=ask\b/);
  expect(s.say("go")).toMatch(/^sessionGate=ask\b/);
  expect(s.stop("Keep --json?")).toBeNull();
});

it.each(CASINGS)("an old auto stamp beats an in-progress mode: away plan (%s payloads)", (casing) => {
  const ws = kit.temp();
  const s = live(casing, ws, "m5");
  const stamp = path.join(ws, ".repo/tmp/orchestrator-logs", `${SESSION_GATE_STAMP}-m5`);
  setKey(s.reviewed("plans", withMode("away")), "status", "in-progress");
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  fs.writeFileSync(stamp, "auto");
  expect(s.say("go")).toMatch(/^sessionGate=ask\b/);
  expect(s.stop("Keep --json?")).toBeNull();
});

it.each(CASINGS)("another session's mode: away plan leaves this session's mode alone (%s payloads)", (casing) => {
  const ws = kit.temp();
  setKey(live(casing, ws, "other").reviewed("plans", withMode("away")), "status", "in-progress");
  const s = live(casing, ws, "m2");
  expect(s.say("go")).toMatch(/^sessionGate=ask\b/);
  expect(s.stop("Keep --json?")).toBeNull();
  expect(s.say("/ask")).toMatch(/^sessionGate=ask\b/);
  expect(s.stop("wrote src/a.ts")).toBeNull();
});

it.each(CASINGS)(
  "away blocks a reply ending in a question, allows an approval block, " +
    "gives up after the stop-block cap, and still runs a settled plan (%s payloads)",
  (casing) => {
    const s = live(casing, kit.temp(), "w1");
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
    const plan = s.reviewed("plans", VALID_PLAN);
    expect(s.stop(`Saved.\n\n${plan1}`)?.reason).toBe(
      `${AWAY_RUN_REASON}; i approves plan 1: plan 1: run /implement-plan-deep 1 (${plan})`,
    );
  },
);

it.each(CASINGS)(
  "a review spawn holds the approval block until the plan's reviews is bumped (%s payloads)",
  (casing) => {
    const s = live(casing, kit.temp(), "r1");
    s.say("plan it");
    const plan = s.reviewed("plans", VALID_PLAN);
    s.spawnReview("/review-plan 1\n\nReview it.");

    const reason =
      "plan 1's review has not settled; wait for it, " +
      "settle its findings with reviews bumped, then end with the approval block";

    expect(s.stop(`Saved.\n\n${plan1}`)).toStrictEqual({ decision: "block", reason });
    setKey(plan, "reviews", "2");
    expect(s.stop(`Saved.\n\n${plan1}`)).toBeNull();
  },
);

it.each(CASINGS)("an approval block naming a plan with reviews: 0 blocks (%s payloads)", (casing) => {
  const s = live(casing, kit.temp(), "z1");
  s.say("plan it");
  s.save(".repo/plans/x.md", VALID_PLAN);
  expect(s.stop(`Saved.\n\n${plan1}`)).toStrictEqual({
    decision: "block",
    reason: "plan 1 has reviews: 0; run /review-plan 1 in a fresh agent first",
  });
});
