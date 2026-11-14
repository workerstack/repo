import fs from "node:fs";

import { expect, it } from "vitest";

import { FAST_PLAN_BODY, FAST_ROADMAP_BODY, modeSession, runBlock } from "./__fixtures__/away-run-kit.ts";
import { read } from "./__fixtures__/fast-session.ts";
import { closing, orchestrateKit, plan as planItem } from "./__fixtures__/orchestrate-kit.ts";
import { VALID_PLAN } from "./__fixtures__/persist-bodies.ts";

const kit = orchestrateKit();

const plan1 = closing(planItem(1));
const ASK_PLAN_1 = { decision: "block", reason: `end with this block:\n${plan1}` };
const LINE_ONE = "1 [ ] ignore tmp: add .tmp/ to .gitignore";

it("an unsettled review still blocks with has not settled under /away", () => {
  const { s } = modeSession(kit, "u1", "/away");
  const plan = s.reviewed("plans", VALID_PLAN);
  const before = read(plan);
  s.spawnReview("/review-plan 1\n\nReview it.");
  expect(s.stop(`Saved.\n\n${plan1}`)).toStrictEqual({
    decision: "block",
    reason:
      "plan 1's review has not settled; wait for it, " +
      "settle its findings with reviews bumped, then end with the approval block",
  });
  expect(read(plan)).toBe(before);
});

it("a plan its prepare update refuses falls through to the block ask", () => {
  const { s } = modeSession(kit, "u2", "/away");
  const plan = s.reviewed("plans", VALID_PLAN);
  const broken = read(plan).replace("## Verify", "## Checks");
  fs.writeFileSync(plan, broken);
  expect(s.stop("Saved.")).toStrictEqual(ASK_PLAN_1);
  expect(read(plan)).toBe(broken);
});

it("a refused plan next to a fast plan that runs is named, and the next Stop asks for its block", () => {
  const { s } = modeSession(kit, "u6", "/away");
  const plan = s.reviewed("plans", VALID_PLAN);
  const fast = s.save(".repo/plans-fast/x.md", FAST_PLAN_BODY);
  fs.writeFileSync(plan, read(plan).replace("## Verify", "## Checks"));
  const reason = s.stop("Saved.")?.reason ?? "";
  const ran = runBlock("fast-plan 1", `run /implement-plan-fast 1 (${fast})`).reason;
  expect(reason.startsWith(`${ran}; plan 1 was not run (`)).toBe(true);
  expect(reason.endsWith(") so end with the approval block for it")).toBe(true);
  expect(s.stop("Saved.")?.reason).toMatch(/^end with this block:\n.*plan 1/s);
});

it("a plan whose file cannot be written falls through to the block ask", () => {
  const { s } = modeSession(kit, "u3", "/away");
  const plan = s.reviewed("plans", VALID_PLAN);
  const before = read(plan);
  fs.chmodSync(plan, 0o444);
  expect(s.stop("Saved.")).toStrictEqual(ASK_PLAN_1);
  fs.chmodSync(plan, 0o644);
  expect(read(plan)).toBe(before);
});

it("a fast plan named by an in-progress fast roadmap gets no block under /away", () => {
  const { s } = modeSession(kit, "u4", "/away");
  const roadmap = s.save(".repo/roadmaps-fast/x.md", FAST_ROADMAP_BODY);
  s.save(roadmap, read(roadmap).replace("status: draft", "status: in-progress"));
  const fast = s.save(".repo/plans-fast/x.md", FAST_PLAN_BODY);
  s.save(roadmap, read(roadmap).replace(LINE_ONE, `${LINE_ONE}\n      Location: ${fast}`));
  const before = read(fast);
  expect(s.stop("Saved the slice's plan.")).toBeNull();
  expect(read(fast)).toBe(before);
});

it("an /ask session keeps the block ask", () => {
  const { s } = modeSession(kit, "u5", "/ask");
  const plan = s.reviewed("plans", VALID_PLAN);
  const before = read(plan);
  expect(s.stop("Saved.")).toStrictEqual(ASK_PLAN_1);
  expect(read(plan)).toBe(before);
});
