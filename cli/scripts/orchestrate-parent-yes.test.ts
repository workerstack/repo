import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { hookSession, type HookSession } from "./fixtures/hook-session.ts";
import { closing, must, orchestrateKit, replyOf, strategyOf, transcript } from "./fixtures/orchestrate-kit.ts";
import { DRAFT_ROADMAP, VALID_PLAN } from "./fixtures/persist-bodies.ts";
import { validatePlan } from "./persist-plan-validate.ts";
import { validateRoadmap } from "./persist-roadmap-validate.ts";

const kit = orchestrateKit();
function claude(ws: string, sid: string): HookSession {
  return hookSession(kit, { env: { CLAUDE_PROJECT_DIR: ws }, shape: "claude", sid, ws });
}
function withStrategy(s: string) {
  return VALID_PLAN.replace("strategy: default", `strategy: ${s}`);
}
function roadmapWith(s: string) {
  return DRAFT_ROADMAP.replace("strategy: default", `strategy: ${s}`);
}
function lines(s: string) {
  return s.split("\n");
}
function read(file: string) {
  return fs.readFileSync(file, "utf8");
}
/** A transcript ending with the closing line for plan 1 at the default strategy. */
function plan1Line(ws: string) {
  return transcript(ws, `Saved.\n\n${closing("plan 1 (strategy: default)")}`);
}

/** A session in a fresh workspace that saved one reviewed plan with `body`. */
function onePlan(sid: string, body = VALID_PLAN): { ws: string; s: HookSession; plan: string } {
  const ws = kit.temp();
  const s = claude(ws, sid);
  s.say("plan it");
  return { plan: s.reviewed("plans", body), s, ws };
}

it("approves exactly what the closing line names, and leaves the file's bytes and strategy alone", () => {
  const { ws, s, plan } = onePlan("s6");
  s.say("and a roadmap");
  const roadmap = s.reviewed("roadmaps", DRAFT_ROADMAP);
  const before = [plan, roadmap].map(read);
  const tp = transcript(
    ws,
    `Both saved.\n\n${closing("plan 1 (strategy: default), then roadmap 1 (strategy: default)")}`,
  );
  for (const text of ["y", "Y "]) {
    expect(lines(s.say(text, tp))).toContain(
      `y approves plan 1, then roadmap 1: plan 1: run /implement-plan 1 (${plan}); ` +
        `roadmap 1: set status locked, then run /implement-roadmap 1 (${roadmap})`,
    );
  }
  expect([plan, roadmap].map(read)).toStrictEqual(before);
  expect(s.say("yes do it", tp)).not.toContain("y approves");
  expect(s.say("y", transcript(ws, "Plan 1 is saved. Start?"))).not.toContain("y approves");
  expect(s.say("y", transcript(ws, 'Reply "y" to run plan 1.'))).not.toContain("y approves");
  expect(s.say("y", transcript(ws, closing("plan 7 (strategy: default)")))).not.toContain("y approves");
  expect(s.say("y")).not.toContain("y approves");
});

it("on a default plan the context is today's, byte for byte", () => {
  const { ws, s, plan } = onePlan("d1");
  expect(lines(s.say("y", plan1Line(ws)))).toContain(`y approves plan 1: plan 1: run /implement-plan 1 (${plan})`);
});

it("a bare y does not approve a line whose strategy differs from the file's", () => {
  const { ws, s, plan } = onePlan("d2", withStrategy("review-fast"));
  expect(s.say("y", plan1Line(ws))).not.toContain("y approves");
  const truthful = transcript(
    ws,
    'Saved.\n\nReply "y" to run plan 1 (strategy: review-fast), or "y default" / "y review-deep", ' +
      'or "h" / "h fast" / "h deep" for a fresh session.',
  );
  expect(s.say("y", truthful)).toContain(`plan 1: run /implement-plan 1 (${plan})`);
  expect(strategyOf(plan)).toBe("review-fast");
});

it("y review-deep writes the strategy, tells the agent to re-read, and a second one changes no bytes", () => {
  const { ws, s, plan } = onePlan("r1");
  const before = read(plan);
  const tp = plan1Line(ws);
  const want =
    "y approves plan 1: plan 1: strategy review-deep was written to its frontmatter; " +
    `re-read the plan, then run /implement-plan 1 (${plan})`;
  expect(lines(s.say("y review-deep", tp))).toContain(want);
  const after = read(plan);
  expect(after).toBe(before.replace("strategy: default", "strategy: review-deep"));
  expect(validatePlan(path.basename(plan), after, { fresh: false, previous: before })).toStrictEqual([]);
  const mtime = fs.statSync(plan).mtimeMs;
  // Nothing left to write: the context is the plain approval, with no claim of a change.
  expect(lines(s.say("Y  Review-Deep ", tp))).toContain(`y approves plan 1: plan 1: run /implement-plan 1 (${plan})`);
  expect(read(plan)).toBe(after);
  expect(fs.statSync(plan).mtimeMs).toBe(mtime);
});

/** The context words for a strategy default written into a `kind`. */
function written(kind: string): string {
  return `strategy default was written to its frontmatter; re-read the ${kind}, then`;
}

it("y default rewrites every item of a queue, a plan and a roadmap", () => {
  const { ws, s, plan: p1 } = onePlan("r2", withStrategy("review-fast"));
  const p2 = s.reviewed("plans", withStrategy("review-deep"));
  const rm = s.reviewed("roadmaps", roadmapWith("review-fast"));
  const tp = transcript(
    ws,
    [
      'Saved.\n\nReply "y" to run plan 1 (strategy: review-fast), then plan 2 (strategy: review-deep), ',
      'then roadmap 1 (strategy: review-fast), or "y default" / "y review-fast" / "y review-deep", ',
      'or "h" / "h fast" / "h deep" for a fresh session.',
    ].join(""),
  );
  expect(s.say("y default", tp)).toContain(
    `y approves plan 1, then plan 2, then roadmap 1: plan 1: ${written("plan")} run /implement-plan 1 (${p1}); ` +
      `plan 2: ${written("plan")} run /implement-plan 2 (${p2}); ` +
      `roadmap 1: ${written("roadmap")} set status locked, then run /implement-roadmap 1 (${rm})`,
  );
  for (const f of [p1, p2, rm]) expect(strategyOf(f)).toBe("default");
  const rmText = read(rm);
  expect(validateRoadmap(path.basename(rm), rmText, { fresh: false, previous: rmText })).toStrictEqual([]);
  s.say("y default", tp);
  expect(read(rm)).toBe(rmText);
});

it("y with a Grok payload writes the strategy too", () => {
  const { ws, plan } = onePlan("g1");
  const fields = { prompt: "y review-fast", transcriptPath: plan1Line(ws) };
  const out = must(replyOf(kit.grok({ sid: "g1", ws }, "UserPromptSubmit", fields)));
  expect(out.hookSpecificOutput.additionalContext).toContain(
    `strategy review-fast was written to its frontmatter; re-read the plan, then run /implement-plan 1 (${plan})`,
  );
  expect(strategyOf(plan)).toBe("review-fast");
});

it("y review-medium approves nothing and names the valid replies", () => {
  const { ws, s, plan } = onePlan("u1");
  const before = read(plan);
  const out = s.say("y review-medium", plan1Line(ws));
  expect(lines(out)).toContain('unknown strategy "review-medium"; use y, y default, y review-fast or y review-deep');
  expect(out).not.toContain("y approves");
  expect(read(plan)).toBe(before);
});

it("an invalid result is never written", () => {
  const { ws, s, plan } = onePlan("e1");
  const tp = plan1Line(ws);
  fs.writeFileSync(plan, read(plan).replace("## Goal", "## Aim"));
  const before = read(plan);
  const out = s.say("y review-deep", tp);
  expect(out).toContain("y did not approve plan 1: strategy review-deep could not be written");
  expect(out).not.toContain("y approves");
  expect(read(plan)).toBe(before);
});
