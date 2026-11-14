import { expect, it } from "vitest";

import { firstWordIs } from "./first-word-is.ts";

const PLAN_ACCEPTED = [
  "plan",
  "Plan.",
  "**plan**",
  "`plan`",
  "/plan",
  "plan: this touches many files",
  "plan\nwhy",
  "  plan  ",
];

const PLAN_REJECTED = ["worktree", "planning", "plan-and-roadmap", "I would plan", ""];

it.each(PLAN_ACCEPTED)("accepts %j for plan", (answer) => {
  expect(firstWordIs("plan")(answer)).toBe(true);
});

it.each(PLAN_REJECTED)("rejects %j for plan", (answer) => {
  expect(firstWordIs("plan")(answer)).toBe(false);
});

it.each(["write-plan-deep", "write-plan-deep: reason", "`/write-plan-deep`", "**Write-Plan-Deep**."])(
  "accepts %j for write-plan-deep",
  (answer) => {
    expect(firstWordIs("write-plan-deep")(answer)).toBe(true);
  },
);

it.each(["write-plan-fast", "write", "plan", "write plan", ""])("rejects %j for write-plan-deep", (answer) => {
  expect(firstWordIs("write-plan-deep")(answer)).toBe(false);
});
