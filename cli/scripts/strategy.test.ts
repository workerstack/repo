import { expect, it } from "vitest";

import { ENFORCED_HARNESSES, APPROVALS, STRATEGIES } from "./strategy.constants.ts";
import { implementerOf, parseApprovalSetting, parseStrategy } from "./strategy.ts";

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
