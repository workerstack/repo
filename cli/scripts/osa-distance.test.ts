import { expect, it } from "vitest";

import { osaDistance } from "./osa-distance.ts";

it("counts a typo as one edit", () => {
  expect(osaDistance("deafult", "default")).toBe(1);
  expect(osaDistance("fats", "fast")).toBe(1);
});

it("counts an adjacent transposition as one edit", () => {
  expect(osaDistance("ab", "ba")).toBe(1);
  expect(osaDistance("spwan", "spawn")).toBe(1);
});

it("counts insertions, deletions and substitutions", () => {
  expect(osaDistance("dep", "deep")).toBe(1);
  expect(osaDistance("deeep", "deep")).toBe(1);
  expect(osaDistance("dead", "deep")).toBe(2);
  expect(osaDistance("kitten", "sitting")).toBe(3);
});

it("is 0 for identical strings", () => {
  expect(osaDistance("fast", "fast")).toBe(0);
  expect(osaDistance("", "")).toBe(0);
});

it("is the other string's length when one is empty", () => {
  expect(osaDistance("", "fast")).toBe(4);
  expect(osaDistance("deep", "")).toBe(4);
});

it("does not edit a substring twice (optimal string alignment, not Damerau-Levenshtein)", () => {
  expect(osaDistance("ca", "abc")).toBe(3);
});
