import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { closingLine } from "./closing-line.ts";
import { hookSession, type HookSession, type Shape } from "./fixtures/hook-session.ts";
import { must, orchestrateKit, strategyOf, transcript } from "./fixtures/orchestrate-kit.ts";
import { DRAFT_ROADMAP, VALID_PLAN } from "./fixtures/persist-bodies.ts";
import { validateHandoff } from "./persist-handoff-validate.ts";

const kit = orchestrateKit();
const SHAPES: readonly Shape[] = ["claude", "grok"];
// Roots and session come from the payload alone, as in a live session.
const UNSET = { CLAUDE_PROJECT_DIR: "", GROK_HOOK_EVENT: "", GROK_SESSION_ID: "", GROK_WORKSPACE_ROOT: "" };
const plan1 = closingLine([{ kind: "plan", serial: 1, strategy: "default" }]);
const handoffs = (ws: string) => {
  const dir = path.join(ws, ".tmp/repo/handoffs");
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => path.join(dir, n)) : [];
};

/** A session in a fresh workspace that saved one reviewed plan. */
function onePlan(shape: Shape, sid: string): { ws: string; s: HookSession; plan: string } {
  const ws = kit.temp();
  const s = hookSession(kit, { env: UNSET, shape, sid, ws });
  s.say("plan it");
  return { plan: s.reviewed("plans", VALID_PLAN), s, ws };
}

/** The one handoff written, its serial and its text. */
function theHandoff(ws: string): { file: string; serial: number; text: string } {
  const files = handoffs(ws);
  expect(files).toHaveLength(1);
  const file = must(files[0]);
  const text = fs.readFileSync(file, "utf8");
  expect(validateHandoff(path.basename(file), text)).toStrictEqual([]);
  return { file, serial: Number(path.basename(file).split("-")[0]), text };
}

it.each(SHAPES)("y and h on an unsettled item refuse with a reason and change nothing (%s payloads)", (shape) => {
  const { ws, s, plan } = onePlan(shape, "u1");
  s.spawnReview("/review-plan 1");
  const before = fs.readFileSync(plan, "utf8");
  const tp = transcript(ws, `Saved.\n\n${plan1}`);
  const why = "its review has not settled; wait for it, then end with the closing line again";
  expect(s.say("y", tp).split("\n")).toContain(`y did not approve plan 1: ${why}`);
  expect(s.say("h fast", tp).split("\n")).toContain(`h did not hand off plan 1: ${why}`);
  expect(fs.readFileSync(plan, "utf8")).toBe(before);
  expect(handoffs(ws)).toStrictEqual([]);
});

it.each(SHAPES)("h fast writes review-fast into the plan and one valid handoff that runs it (%s payloads)", (shape) => {
  const { ws, s, plan } = onePlan(shape, "h1");
  const ctx = s.say("h fast", transcript(ws, `Saved.\n\n${plan1}`));
  const { file, serial, text } = theHandoff(ws);
  expect(path.basename(file)).toMatch(/^\d+-run-plan-1-\d{8}T\d{6}Z\.md$/);
  expect(ctx.split("\n")).toContain(
    `h handed off plan 1 (strategy review-fast written) to ${file}; tell the person to run /pickup ${serial} in a fresh session, and do no work here`,
  );
  expect(text).toContain(plan);
  expect(text).toContain("h1");
  expect(text).toMatch(/^1\.1 \[ \] \/implement-plan 1$/m);
  expect(strategyOf(plan)).toBe("review-fast");
});

it.each(SHAPES)(
  "a bare h on a plan and a roadmap writes one handoff with a leaf per item, in order (%s payloads)",
  (shape) => {
    const { ws, s, plan } = onePlan(shape, "h2");
    const roadmap = s.reviewed("roadmaps", DRAFT_ROADMAP);
    const line = closingLine([
      { kind: "plan", serial: 1, strategy: "default" },
      { kind: "roadmap", serial: 1, strategy: "default" },
    ]);
    const ctx = s.say("h", transcript(ws, `Both saved.\n\n${line}`));
    const { file, serial, text } = theHandoff(ws);
    expect(path.basename(file)).toMatch(/^\d+-run-plan-1-then-roadmap-1-\d{8}T\d{6}Z\.md$/);
    expect(ctx.split("\n")).toContain(
      `h handed off plan 1 (strategy default), then roadmap 1 (strategy default) to ${file}; tell the person to run /pickup ${serial} in a fresh session, and do no work here`,
    );
    expect(text).toContain(plan);
    expect(text).toContain(roadmap);
    const leaves = text.split("\n").filter((l) => /^\d+\.\d+ \[ \] /.test(l));
    expect(leaves).toStrictEqual(["1.1 [ ] /implement-plan 1", "1.2 [ ] set status locked, then /implement-roadmap 1"]);
    expect([strategyOf(plan), strategyOf(roadmap)]).toStrictEqual(["default", "default"]);
  },
);
