import { expect, it } from "vitest";

import { firstNonEmpty } from "./first-non-empty.ts";

it("firstNonEmpty: skips undefined and empty strings", () => {
  expect(firstNonEmpty(undefined, "", "a", "b")).toBe("a");
});

it("firstNonEmpty: is undefined when no value is set", () => {
  expect(firstNonEmpty("", undefined)).toBeUndefined();
  expect(firstNonEmpty()).toBeUndefined();
});
