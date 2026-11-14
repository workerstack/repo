import fs from "node:fs";

import { expect, it } from "vitest";

import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { planFile, planText, REVIEW_SID, reviewWrite, type PlanAt } from "./__fixtures__/review-plan.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import { activeReviews, stampedPlans } from "./review-stamps.ts";

const tmp = useTmp();

/** A parent Write of a plan or fast plan with `strategy` at `status`, landed on disk after the gate; returns its
 * path. */
function save(w: string, spec: { strategy: string; status: string } & PlanAt) {
  const { file } = planFile(w, "free", "ready", spec);
  const content = planText(spec.strategy, spec.status, spec.serial);
  fs.rmSync(file);
  processFatTools(reviewWrite("claudeWrite", { content, cwd: w, target: file }));
  fs.writeFileSync(file, content);

  return file;
}

/** The session's stamped plans, as a set. */
function stamps(w: string) {
  return new Set(stampedPlans(w, REVIEW_SID));
}

it("stamps spawn plan 3 and spawn fast plan 4 side by side, each one file", () => {
  const w = tmp.dir("gate-review-");
  const plan = save(w, { serial: 3, status: "in-progress", strategy: "spawn-fast" });
  const fast = save(w, { fast: true, serial: 4, status: "in-progress", strategy: "spawn-deep" });
  expect(stamps(w)).toStrictEqual(new Set([plan, fast]));

  expect(activeReviews(w, REVIEW_SID)).toStrictEqual([
    { kind: "plan", plan, serial: 3, strategy: "spawn-fast" },
    { kind: "fast-plan", plan: fast, serial: 4, strategy: "spawn-deep" },
  ]);
});

it.each([
  ["done", "spawn-fast"],
  ["blocked", "spawn-fast"],
  ["in-progress", "free"],
])("a Write of plan 3 at %s with %s removes its stamp and keeps fast plan 4", (status, strategy) => {
  const w = tmp.dir("gate-review-");
  save(w, { serial: 3, status: "in-progress", strategy: "spawn-fast" });
  const fast = save(w, { fast: true, serial: 4, status: "in-progress", strategy: "spawn-deep" });
  save(w, { serial: 3, status, strategy });
  expect(stamps(w)).toStrictEqual(new Set([fast]));
});

it("an Edit that sets plan 3 done keeps its stamp until the next plan save prunes it", () => {
  const w = tmp.dir("gate-review-");
  const plan = save(w, { serial: 3, status: "in-progress", strategy: "spawn-fast" });
  processFatTools(reviewWrite("claudeEdit", { cwd: w, target: plan }));
  fs.writeFileSync(plan, planText("spawn-fast", "done"));
  expect(stamps(w)).toStrictEqual(new Set([plan]));
  expect(activeReviews(w, REVIEW_SID)).toStrictEqual([]);
  const next = save(w, { serial: 5, status: "ready", strategy: "spawn-deep" });
  expect(stamps(w)).toStrictEqual(new Set([next]));
});

it("prunes a stamped plan whose file is gone at the next plan save, and not at a product write", () => {
  const w = tmp.dir("gate-review-");
  const plan = save(w, { serial: 3, status: "in-progress", strategy: "spawn-fast" });
  fs.rmSync(plan);
  processFatTools(reviewWrite("claudeWrite", { cwd: w, target: `${w}/src/x.ts` }));
  expect(stamps(w)).toStrictEqual(new Set([plan]));
  const fast = save(w, { fast: true, serial: 4, status: "ready", strategy: "spawn-fast" });
  expect(stamps(w)).toStrictEqual(new Set([fast]));
});
