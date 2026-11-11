import { execFileSync } from "node:child_process";

import { expect, it } from "vitest";

it("gives every git a test runs background work switched off", () => {
  const get = (key: string) => execFileSync("git", ["config", "--get", key], { encoding: "utf8" }).trim();
  expect(get("maintenance.auto")).toBe("false");
  expect(get("gc.auto")).toBe("0");
  expect(get("core.fsmonitor")).toBe("false");
});
