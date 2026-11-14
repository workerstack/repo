import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { hookSession, type HookSession } from "./__fixtures__/hook-session.ts";
import {
  closing,
  fastPlan,
  orchestrateKit,
  parseJson,
  plan as planItem,
  strategyOf,
  transcript,
} from "./__fixtures__/orchestrate-kit.ts";
import { ADVICE, PLAN } from "./__fixtures__/save-strategy-kit.ts";
import type { Strategy } from "./strategy.types.ts";

const kit = orchestrateKit();

const SAVED = ADVICE.replace("advice: ", "");
const USAGE = "is not a choice; reply i or h, alone or with free, fast or deep; end with this block again:";

function claude(ws: string, sid: string): HookSession {
  return hookSession(kit, { casing: "claude", env: { CLAUDE_PROJECT_DIR: ws }, sid, ws });
}

/** A session that `/set` to `strategy` and saved one reviewed plan that carries advice. */
function onePlan(sid: string, strategy = "free") {
  const ws = kit.temp();
  const s = claude(ws, sid);
  s.say(`/set ${strategy}`);
  s.say("plan it");

  return { plan: s.reviewed("plans", PLAN), s, ws };
}

/** The `strategy` the session store holds; undefined when it holds none. */
function stored(ws: string, sid: string): string | undefined {
  const file = path.join(ws, ".repo/tmp/sessions", sid, "settings.json");

  const held = parseJson<{ strategy?: string }>(fs.readFileSync(file, "utf8"));

  return held.strategy;
}

function blockOf(strategy: Strategy = "free") {
  return closing(planItem(1, strategy, SAVED));
}

it("a retired code gets the Usage line and the block again, and approves nothing", () => {
  const { s, ws, plan } = onePlan("w1");
  const tp = transcript(ws, `Saved.\n\n${blockOf()}`);
  const before = fs.readFileSync(plan, "utf8");

  for (const code of ["if", "isf", "isd", "hf", "hsf", "hsd"]) {
    const out = s.say(code, tp);
    expect(out, code).toContain(`"${code}" ${USAGE}\n${blockOf()}`);
    expect(out, code).not.toContain("approves");
    expect(out, code).not.toContain("handed off");
  }

  expect(fs.readFileSync(plan, "utf8")).toBe(before);
  expect(stored(ws, "w1")).toBe("free");
});

it("on a fast-only block a code and a strategy word get the short Usage line", () => {
  const ws = kit.temp();
  const s = claude(ws, "w2");
  s.say("do the small thing");
  const block = closing(fastPlan(1));
  const tp = transcript(ws, `Saved.\n\n${block}`);

  for (const reply of ["isf", "i fast"]) {
    const line = `"${reply}" is not a choice; reply i or h; end with this block again:`;

    expect(s.say(reply, tp)).toContain(`${line}\n${block}`);
  }
});

it("i fast writes spawn-fast to the plan and the session, and the context says so", () => {
  const { s, ws, plan } = onePlan("w3");
  const out = s.say("i fast", transcript(ws, `Saved.\n\n${blockOf()}`));

  expect(out).toContain("i approves plan 1");
  expect(out).toContain("set strategy spawn-fast (was free)");
  expect(strategyOf(plan)).toBe("spawn-fast");
  expect(stored(ws, "w3")).toBe("spawn-fast");
});

it("a bare i leaves the session strategy alone", () => {
  const { s, ws } = onePlan("w4");

  expect(s.say("i", transcript(ws, `Saved.\n\n${blockOf()}`))).not.toContain("set strategy");
  expect(stored(ws, "w4")).toBe("free");
});

it("a refused i fast leaves the session strategy alone", () => {
  const { s, ws, plan } = onePlan("w5");
  fs.writeFileSync(path.join(ws, ".repo/tmp/sessions/w5/reviews-open.json"), '{"plan 1":1}');
  const out = s.say("i fast", transcript(ws, `Saved.\n\n${blockOf()}`));

  expect(out).toContain("i did not approve plan 1: its review has not settled");
  expect(out).not.toContain("set strategy");
  expect(strategyOf(plan)).toBe("free");
  expect(stored(ws, "w5")).toBe("free");
});

it("an i fast whose write fails leaves the session strategy alone", () => {
  const { s, ws, plan } = onePlan("w6");
  fs.chmodSync(plan, 0o444);
  const out = s.say("i fast", transcript(ws, `Saved.\n\n${blockOf()}`));

  expect(out).toContain("i did not approve plan 1: strategy spawn-fast could not be written");
  expect(out).not.toContain("set strategy");
  expect(stored(ws, "w6")).toBe("free");
});

it("h deep hands off with spawn-deep and leaves the session strategy alone", () => {
  const { s, ws, plan } = onePlan("w7");
  const out = s.say("h deep", transcript(ws, `Saved.\n\n${blockOf()}`));

  expect(out).toContain("h handed off plan 1 (strategy spawn-deep written)");
  expect(out).not.toContain("set strategy");
  expect(strategyOf(plan)).toBe("spawn-deep");
  expect(stored(ws, "w7")).toBe("free");
});

it("Stop asks for the real block when the advice row differs from the file's advice", () => {
  const wrong = closing(planItem(1, "free", "free because i say so"));
  const none = closing(planItem(1, "free"));

  expect(onePlan("w8").s.stop(`Saved.\n\n${blockOf()}`)).toBeNull();
  expect(onePlan("w8b").s.stop(`Saved.\n\n${wrong}`)?.reason).toBe(`end with this block:\n${blockOf()}`);
  expect(onePlan("w8c").s.stop(`Saved.\n\n${none}`)?.reason).toBe(`end with this block:\n${blockOf()}`);
});
