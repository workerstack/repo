import { expect, it } from "vitest";

import { byCodeUnit } from "./by-code-unit.ts";

it("orders by code unit, uppercase before lowercase, and keeps equal strings level", () => {
  expect(["b", "a", "B", "a"].toSorted(byCodeUnit)).toStrictEqual(["B", "a", "a", "b"]);
  expect(byCodeUnit("a", "a")).toBe(0);
});
