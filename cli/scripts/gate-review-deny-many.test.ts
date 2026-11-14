import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { planText, reviewReason, reviewWrite, startReview } from "./__fixtures__/review-plan.ts";
import { processFatTools } from "./gate-fat-tools.ts";

const tmp = useTmp();

/** The answer a parent's write of `src/x.ts` gets. */
function productWrite(w: string) {
  return processFatTools(reviewWrite("claudeWrite", { cwd: w, target: path.join(w, "src/x.ts") }));
}

const TAIL = "the plans, the journals and .repo/ work dirs stay writable.";

it("names both running plans, plans before fast plans", () => {
  const w = tmp.dir("gate-review-");
  startReview(w, { fast: true, serial: 4, strategy: "spawn-deep" });
  startReview(w, { strategy: "spawn-fast" });

  expect(productWrite(w)).toStrictEqual({
    reason:
      "plan 3 runs strategy spawn-fast and fast-plan 4 runs strategy spawn-deep: this session reviews. " +
      `Spawn implementer-fast for plan 3 and implementer-deep for fast-plan 4; ${TAIL}`,
    type: "deny",
  });
});

it("names three running plans by serial, and only the one left once the others are done", () => {
  const w = tmp.dir("gate-review-");
  const five = startReview(w, { serial: 5, strategy: "spawn-deep" });
  const fast = startReview(w, { fast: true, serial: 4, strategy: "spawn-deep" });
  startReview(w, { strategy: "spawn-fast" });

  expect(productWrite(w)).toStrictEqual({
    reason:
      "plan 3 runs strategy spawn-fast, plan 5 runs strategy spawn-deep and fast-plan 4 runs strategy spawn-deep: " +
      "this session reviews. Spawn implementer-fast for plan 3, implementer-deep for plan 5 and implementer-deep " +
      `for fast-plan 4; ${TAIL}`,
    type: "deny",
  });

  fs.writeFileSync(five, planText("spawn-deep", "done", 5));
  fs.writeFileSync(fast, planText("spawn-deep", "done", 4));
  expect(productWrite(w)).toStrictEqual({ reason: reviewReason("spawn-fast"), type: "deny" });
});

it("counts only in-progress plans: a ready stamped plan beside a running one leaves the one-plan deny", () => {
  const w = tmp.dir("gate-review-");
  startReview(w, { serial: 6, status: "ready", strategy: "spawn-deep" });
  startReview(w, { strategy: "spawn-deep" });
  expect(productWrite(w)).toStrictEqual({ reason: reviewReason("spawn-deep"), type: "deny" });
});
