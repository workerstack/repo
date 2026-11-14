import { afterEach, expect, it } from "vitest";

import { A, B, C, cleanRigs, failedLine, noResult, pushed } from "./__fixtures__/push-gate-rig.ts";

afterEach(cleanRigs);

const TEST = ["test (windows-latest)"];

it.each([
  ["superseded", "superseded"],
  ["no record", null],
] as const)("settles a push with %s by a later passed commit it did not push", (_name, outcome) => {
  const r = pushed([["main", A]]);

  if (outcome !== null) r.result(A, outcome);
  r.result(C, "passed");
  expect(r.gate()).toBeNull();
});

it("a later failed commit does not settle a superseded push", () => {
  const r = pushed([["main", A]]);
  r.result(A, "superseded");
  r.result(B, "failed", TEST);
  expect(r.gate()).toBe(noResult(A));
});

it("an older passed commit does not settle a superseded push", () => {
  const r = pushed([["main", C]]);
  r.result(C, "superseded");
  r.result(A, "passed");
  expect(r.gate()).toBe(noResult(C));
});

it("a later passed commit does not hide the push's own failure", () => {
  const r = pushed([["main", A]]);
  r.result(A, "failed", TEST);
  r.result(B, "passed");
  expect(r.gate()).toBe(failedLine(A, TEST.join(", ")));
});

it("blocks a superseded push when git cannot list the later commits", () => {
  const r = pushed([["main", A]], { revListFails: [A] });
  r.result(A, "superseded");
  r.result(B, "passed");
  expect(r.gate()).toBe(noResult(A));
});
