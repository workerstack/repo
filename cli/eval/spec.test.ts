import { expect, it } from "vitest";

import { defineEval } from "./spec.ts";

it("returns its argument", () => {
  const spec = { cases: [], system: "s" };

  expect(defineEval(spec)).toBe(spec);
});
