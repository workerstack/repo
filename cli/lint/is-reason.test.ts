import { describe, expect, it } from "vitest";

import { isReason } from "./is-reason.ts";

describe("isReason", () => {
  it.each([
    "the schema parsed it above",
    ' "lint" is not a pack',
    "caller's input checked twice",
    "überprüft vom Aufrufer",
  ])("takes %j as a reason", (text) => {
    expect(isReason(text)).toBe(true);
  });

  it.each(["", "ok", "safe", "parsed above", " 1 2 3 4 ", "-- -- --", "x-y z-w"])("refuses %j", (text) => {
    expect(isReason(text)).toBe(false);
  });
});
