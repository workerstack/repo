import { execFileSync } from "node:child_process";

import { expect, it } from "vitest";

function get(key: string) {
  return execFileSync("git", ["config", "--get", key], { encoding: "utf8" }).trim();
}

it("gives every git a test runs background work switched off", () => {
  expect(get("maintenance.auto")).toBe("false");
  expect(get("gc.auto")).toBe("0");
  expect(get("core.fsmonitor")).toBe("false");
});
