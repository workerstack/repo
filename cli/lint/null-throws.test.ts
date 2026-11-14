import { expect, it } from "vitest";

import { nullThrows } from "./null-throws.ts";

it("returns a value it is given, falsy ones too", () => {
  expect(nullThrows(0, "missing")).toBe(0);
  expect(nullThrows("", "missing")).toBe("");
});

it.each([null, undefined])("throws its message for %s", (value) => {
  expect(() => nullThrows(value, "the Program visitor runs first")).toThrow("the Program visitor runs first");
});
