import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { hookSession, type HookSession } from "./__fixtures__/hook-session.ts";
import {
  closing,
  must,
  orchestrateKit,
  plan as planItem,
  replyOf,
  roadmap as roadmapItem,
  strategyOf,
  transcript,
} from "./__fixtures__/orchestrate-kit.ts";
import { DRAFT_ROADMAP, VALID_PLAN } from "./__fixtures__/persist-bodies.ts";
import { validatePlan } from "./persist-plan-validate.ts";
import { validateRoadmap } from "./persist-roadmap-validate.ts";

const kit = orchestrateKit();

function claude(ws: string, sid: string): HookSession {
  return hookSession(kit, { casing: "claude", env: { CLAUDE_PROJECT_DIR: ws }, sid, ws });
}

function withStrategy(s: string) {
  return VALID_PLAN.replace("strategy: free", `strategy: ${s}`);
}

function roadmapWith(s: string) {
  return DRAFT_ROADMAP.replace("strategy: free", `strategy: ${s}`);
}

function lines(s: string) {
  return s.split("\n");
}

function read(file: string) {
  return fs.readFileSync(file, "utf8");
}

/** A transcript ending with the approval block for plan 1 at the default strategy. */
function plan1Line(ws: string) {
  return transcript(ws, `Saved.\n\n${closing(planItem(1))}`);
}

/** A session in a fresh workspace that saved one reviewed plan with `body`. */
function onePlan(sid: string, body = VALID_PLAN) {
  const ws = kit.temp();
  const s = claude(ws, sid);
  s.say("plan it");

  return { plan: s.reviewed("plans", body), s, ws };
}

it("approves exactly what the approval block names, and leaves the file's bytes and strategy alone", () => {
  const { ws, s, plan } = onePlan("s6");
  s.say("and a roadmap");
  const roadmap = s.reviewed("roadmaps", DRAFT_ROADMAP);
  const before = [plan, roadmap].map(read);

  const tp = transcript(ws, `Both saved.\n\n${closing(planItem(1), roadmapItem(1))}`);

  for (const text of ["i", "y", "Y ", "go", "Do it!"]) {
    expect(lines(s.say(text, tp))).toContain(
      `i approves plan 1, then roadmap 1: plan 1: run /implement-plan 1 (${plan}); ` +
        `roadmap 1: set status locked, then run /implement-roadmap 1 (${roadmap})`,
    );
  }

  expect([plan, roadmap].map(read)).toStrictEqual(before);
  expect(s.say("yes do it", tp)).not.toContain("i approves");
  expect(s.say("y", transcript(ws, "Plan 1 is saved. Start?"))).not.toContain("i approves");
  expect(s.say("y", transcript(ws, 'Reply "y" to run plan 1.'))).not.toContain("i approves");
  expect(s.say("y", transcript(ws, closing(planItem(7))))).not.toContain("i approves");
  expect(s.say("y")).not.toContain("i approves");
});

it("a reply that only starts like a choice is a revision and adds no approval context", () => {
  const { ws, s } = onePlan("v1");
  const tp = plan1Line(ws);

  for (const text of ["go with B but change X", "test", "keep", "hi", "i have a question", "y review-medium"]) {
    const out = s.say(text, tp);
    expect(out, text).not.toContain("approves");
    expect(out, text).not.toContain("not a choice");
  }
});

it("on a default plan the context is today's, byte for byte", () => {
  const { ws, s, plan } = onePlan("d1");
  expect(lines(s.say("y", plan1Line(ws)))).toContain(`i approves plan 1: plan 1: run /implement-plan 1 (${plan})`);
});

it("a bare i does not approve a block whose strategy differs from the file's", () => {
  const { ws, s, plan } = onePlan("d2", withStrategy("spawn-fast"));
  expect(s.say("y", plan1Line(ws))).not.toContain("i approves");

  const truthful = transcript(ws, `Saved.\n\n${closing(planItem(1, "spawn-fast"))}`);

  expect(s.say("i", truthful)).toContain(`plan 1: run /implement-plan 1 (${plan})`);
  expect(strategyOf(plan)).toBe("spawn-fast");
});

it("isf and implement fere write the strategy they name, and hsd is no approval", () => {
  const { ws, s, plan } = onePlan("c1", withStrategy("spawn-fast"));
  const tp = transcript(ws, `Saved.\n\n${closing(planItem(1, "spawn-fast"))}`);
  expect(s.say("isf", tp)).toContain(`i approves plan 1: plan 1: run /implement-plan 1 (${plan})`);
  expect(strategyOf(plan)).toBe("spawn-fast");
  expect(s.say("isd", tp)).toContain("strategy spawn-deep was written to its frontmatter");
  expect(strategyOf(plan)).toBe("spawn-deep");
  expect(s.say("implement fere", transcript(ws, `Saved.\n\n${closing(planItem(1, "spawn-deep"))}`))).toContain(
    "strategy free was written to its frontmatter",
  );
  expect(strategyOf(plan)).toBe("free");
  expect(s.say("hsd", plan1Line(ws))).not.toContain("i approves");
});

it("y spawn-deep writes the strategy, tells the agent to re-read, and a second one changes no bytes", () => {
  const { ws, s, plan } = onePlan("r1");
  const before = read(plan);
  const tp = plan1Line(ws);

  const want =
    "i approves plan 1: plan 1: strategy spawn-deep was written to its frontmatter; " +
    `re-read the plan, then run /implement-plan 1 (${plan})`;

  expect(lines(s.say("y spawn-deep", tp))).toContain(want);
  const after = read(plan);
  expect(after).toBe(before.replace("strategy: free", "strategy: spawn-deep"));
  expect(validatePlan(path.basename(plan), after, { fresh: false, previous: before })).toStrictEqual([]);
  const mtime = fs.statSync(plan).mtimeMs;
  // Nothing left to write: the context is the plain approval, with no claim of a change.
  expect(lines(s.say("Y  Spawn-Deep ", tp))).toContain(`i approves plan 1: plan 1: run /implement-plan 1 (${plan})`);
  expect(read(plan)).toBe(after);
  expect(fs.statSync(plan).mtimeMs).toBe(mtime);
});

/** The context words for a strategy free written into a `kind`. */
function written(kind: string): string {
  return `strategy free was written to its frontmatter; re-read the ${kind}, then`;
}

it("y free rewrites every item of a queue, a plan and a roadmap", () => {
  const { ws, s, plan: p1 } = onePlan("r2", withStrategy("spawn-fast"));
  const p2 = s.reviewed("plans", withStrategy("spawn-deep"));
  const rm = s.reviewed("roadmaps", roadmapWith("spawn-fast"));

  const tp = transcript(
    ws,
    `Saved.\n\n${closing(planItem(1, "spawn-fast"), planItem(2, "spawn-deep"), roadmapItem(1, "spawn-fast"))}`,
  );

  expect(s.say("y free", tp)).toContain(
    `i approves plan 1, then plan 2, then roadmap 1: plan 1: ${written("plan")} run /implement-plan 1 (${p1}); ` +
      `plan 2: ${written("plan")} run /implement-plan 2 (${p2}); ` +
      `roadmap 1: ${written("roadmap")} set status locked, then run /implement-roadmap 1 (${rm})`,
  );

  for (const f of [p1, p2, rm]) expect(strategyOf(f)).toBe("free");
  const rmText = read(rm);
  expect(validateRoadmap(path.basename(rm), rmText, { fresh: false, previous: rmText })).toStrictEqual([]);
  s.say("y free", tp);
  expect(read(rm)).toBe(rmText);
});

it("y with a Grok payload writes the strategy too", () => {
  const { ws, plan } = onePlan("g1");
  const fields = { prompt: "y spawn-fast", transcriptPath: plan1Line(ws) };
  const out = must(replyOf(kit.grok({ sid: "g1", ws }, "UserPromptSubmit", fields)));
  expect(out.hookSpecificOutput.additionalContext).toContain(
    `strategy spawn-fast was written to its frontmatter; re-read the plan, then run /implement-plan 1 (${plan})`,
  );
  expect(strategyOf(plan)).toBe("spawn-fast");
});

it("isx and i daet approve nothing and show the block again", () => {
  const { ws, s, plan } = onePlan("u1");
  const before = read(plan);

  for (const reply of ["isx", "i daet"]) {
    const out = s.say(reply, plan1Line(ws));
    expect(out).toContain(`"${reply}" is not a choice; end with this block again:\n${closing(planItem(1))}`);
    expect(out).not.toContain("i approves");
  }

  expect(read(plan)).toBe(before);
});

it("an invalid result is never written", () => {
  const { ws, s, plan } = onePlan("e1");
  const tp = plan1Line(ws);
  fs.writeFileSync(plan, read(plan).replace("## Goal", "## Aim"));
  const before = read(plan);
  const out = s.say("y spawn-deep", tp);
  expect(out).toContain("i did not approve plan 1: strategy spawn-deep could not be written");
  expect(out).not.toContain("i approves");
  expect(read(plan)).toBe(before);
});
