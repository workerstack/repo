import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { hookSession, type Casing } from "./__fixtures__/hook-session.ts";
import { must, orchestrateKit, strategyOf, transcript } from "./__fixtures__/orchestrate-kit.ts";
import { DRAFT_ROADMAP, VALID_PLAN } from "./__fixtures__/persist-bodies.ts";
import { closingLine } from "./closing-line.ts";
import { validateHandoff } from "./persist-handoff-validate.ts";

const kit = orchestrateKit();
const CASINGS: readonly Casing[] = ["claude", "grok"];

// Roots and session come from the payload alone, as in a live session.
const UNSET = { CLAUDE_PROJECT_DIR: "", GROK_HOOK_EVENT: "", GROK_SESSION_ID: "", GROK_WORKSPACE_ROOT: "" };
const plan1 = closingLine([{ kind: "plan", serial: 1, strategy: "default" }]);

function handoffs(ws: string) {
  const dir = path.join(ws, ".repo/handoffs");

  return fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => path.join(dir, n)) : [];
}

/** A session in a fresh workspace that saved one reviewed plan. */
function onePlan(casing: Casing, sid: string) {
  const ws = kit.temp();
  const s = hookSession(kit, { casing, env: UNSET, sid, ws });
  s.say("plan it");

  return { plan: s.reviewed("plans", VALID_PLAN), s, ws };
}

/** The one handoff written, its serial and its text. */
function theHandoff(ws: string) {
  const files = handoffs(ws);
  expect(files).toHaveLength(1);
  const file = must(files[0]);
  const text = fs.readFileSync(file, "utf8");
  expect(validateHandoff(path.basename(file), text)).toStrictEqual([]);

  return { file, serial: Number(path.basename(file).split("-")[0]), text };
}

it.each(CASINGS)("y and h on an unsettled item refuse with a reason and change nothing (%s payloads)", (casing) => {
  const { ws, s, plan } = onePlan(casing, "u1");
  s.spawnReview("/review-plan 1");
  const before = fs.readFileSync(plan, "utf8");
  const tp = transcript(ws, `Saved.\n\n${plan1}`);
  const why = "its review has not settled; wait for it, then end with the closing line again";
  expect(s.say("y", tp).split("\n")).toContain(`y did not approve plan 1: ${why}`);
  expect(s.say("h fast", tp).split("\n")).toContain(`h did not hand off plan 1: ${why}`);
  expect(fs.readFileSync(plan, "utf8")).toBe(before);
  expect(handoffs(ws)).toStrictEqual([]);
});

it.each(CASINGS)(
  "h fast writes spawn-fast into the plan and one valid handoff that runs it (%s payloads)",
  (casing) => {
    const { ws, s, plan } = onePlan(casing, "h1");
    const ctx = s.say("h fast", transcript(ws, `Saved.\n\n${plan1}`));
    const { file, serial, text } = theHandoff(ws);
    expect(path.basename(file)).toMatch(/^\d+-run-plan-1-\d{8}T\d{6}Z\.md$/);
    expect(ctx.split("\n")).toContain(
      `h handed off plan 1 (strategy spawn-fast written) to ${file}; ` +
        `tell the person to run /pickup ${serial} in a fresh session, and do no work here`,
    );
    expect(text).toContain(plan);
    expect(text).toContain("h1");
    expect(text).toMatch(/^1\.1 \[ \] \/implement-plan 1$/m);
    expect(strategyOf(plan)).toBe("spawn-fast");
  },
);

it.each(CASINGS)(
  "a bare h on a plan and a roadmap writes one handoff with a leaf per item, in order (%s payloads)",
  (casing) => {
    const { ws, s, plan } = onePlan(casing, "h2");
    const roadmap = s.reviewed("roadmaps", DRAFT_ROADMAP);

    const line = closingLine([
      { kind: "plan", serial: 1, strategy: "default" },
      { kind: "roadmap", serial: 1, strategy: "default" },
    ]);

    const ctx = s.say("h", transcript(ws, `Both saved.\n\n${line}`));
    const { file, serial, text } = theHandoff(ws);
    expect(path.basename(file)).toMatch(/^\d+-run-plan-1-then-roadmap-1-\d{8}T\d{6}Z\.md$/);
    expect(ctx.split("\n")).toContain(
      `h handed off plan 1 (strategy default), then roadmap 1 (strategy default) to ${file}; ` +
        `tell the person to run /pickup ${serial} in a fresh session, and do no work here`,
    );
    expect(text).toContain(plan);
    expect(text).toContain(roadmap);
    const leaves = text.split("\n").filter((l) => /^\d+\.\d+ \[ \] /.test(l));
    expect(leaves).toStrictEqual(["1.1 [ ] /implement-plan 1", "1.2 [ ] set status locked, then /implement-roadmap 1"]);
    expect([strategyOf(plan), strategyOf(roadmap)]).toStrictEqual(["default", "default"]);
  },
);
