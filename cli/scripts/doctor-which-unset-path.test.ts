import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { whichBin, withNmBin } from "./doctor-which.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("finds nothing when PATH is unset", () => {
  vi.stubEnv("PATH", undefined);
  expect(whichBin("bun")).toBe("");
});

it("puts only the checkout's node_modules/.bin on an unset PATH", () => {
  const nm = path.join("/c", "node_modules", ".bin");
  expect(withNmBin("/c", undefined, "linux")).toBe(`${nm}${path.delimiter}`);
  expect(withNmBin("/c", undefined, "win32")).toBe(`${nm}${path.delimiter}`);
});
