import { expect, it } from "vitest";

import { ENFORCED_HARNESSES, APPROVALS, STRATEGIES } from "./strategy.constants.ts";
import { hasStrategy, implementerOf, kindHasStrategy, parseApprovalSetting, parseStrategy } from "./strategy.ts";

it("accepts exactly the three values", () => {
  expect(STRATEGIES).toStrictEqual(["free", "spawn-fast", "spawn-deep"]);

  for (const s of STRATEGIES) expect(parseStrategy(s)).toBe(s);

  for (const bad of ["review-fast", "review-deep", "review-medium", "Free", " free", "default", "", undefined])
    expect(parseStrategy(bad)).toBeNull();
});

it("spawn-fast starts fast then goes deep; spawn-deep is deep both times", () => {
  expect(implementerOf("spawn-fast", 1)).toBe("implementer-fast");
  expect(implementerOf("spawn-fast", 2)).toBe("implementer-deep");
  expect(implementerOf("spawn-deep", 1)).toBe("implementer-deep");
  expect(implementerOf("spawn-deep", 2)).toBe("implementer-deep");
});

it("accepts exactly ask and away", () => {
  expect(APPROVALS).toStrictEqual(["ask", "away"]);

  for (const m of APPROVALS) expect(parseApprovalSetting(m)).toBe(m);

  for (const bad of ["auto", "Away", " ask", "", "review", undefined]) expect(parseApprovalSetting(bad)).toBeNull();
});

it("enforces the harnesses whose child payload carries a marker: claude (and Grok through it) and codex", () => {
  expect([...ENFORCED_HARNESSES].toSorted()).toStrictEqual(["claude", "codex"]);
});

it("tells an item that has a strategy from a fast plan or fast roadmap", () => {
  expect(hasStrategy({ advice: null, kind: "plan", serial: 1, strategy: "free" })).toBe(true);
  expect(hasStrategy({ advice: null, kind: "roadmap", serial: 1, strategy: "spawn-deep" })).toBe(true);
  expect(hasStrategy({ kind: "fast-plan", serial: 1 })).toBe(false);
  expect(hasStrategy({ kind: "fast-roadmap", serial: 1 })).toBe(false);
  expect(kindHasStrategy("plan")).toBe(true);
  expect(kindHasStrategy("fast-roadmap")).toBe(false);
});
