import { expect, it, vi } from "vitest";

import { usePresetDefaults } from "./__fixtures__/platform.ts";
import { defineConfig, defineProject } from "./vitest.ts";

const NO_FLOORS = { floors: "no-such-floors.json" };
const setPlatform = usePresetDefaults();

it.each([
  ["win32", 60_000],
  ["linux", 5_000],
] as const)("defineProject: on %s gives %d ms timeouts and the forks pool", (os, ms) => {
  setPlatform(os);
  expect(defineProject({})).toStrictEqual({
    test: {
      deps: { interopDefault: false },
      hookTimeout: ms,
      pool: "forks",
      testTimeout: ms,
    },
  });
});

it("defineProject: keeps a timeout the caller passes", () => {
  setPlatform("linux");
  expect(defineProject({ test: { testTimeout: 1_234 } }).test).toMatchObject({
    hookTimeout: 5_000,
    testTimeout: 1_234,
  });
});

it("REPO_VITEST_TIMEOUT: replaces the platform default for tests and hooks", () => {
  setPlatform("linux");
  vi.stubEnv("REPO_VITEST_TIMEOUT", "60000");
  expect(defineProject({}).test).toMatchObject({ hookTimeout: 60_000, testTimeout: 60_000 });
  expect(defineConfig({}, NO_FLOORS).test).toMatchObject({ hookTimeout: 60_000, testTimeout: 60_000 });
});

it("REPO_VITEST_TIMEOUT: leaves a timeout the caller passes alone", () => {
  setPlatform("linux");
  vi.stubEnv("REPO_VITEST_TIMEOUT", "60000");
  expect(defineConfig({ test: { testTimeout: 120_000 } }, NO_FLOORS).test).toMatchObject({
    hookTimeout: 60_000,
    testTimeout: 120_000,
  });
});

it.each(["abc", "0", "1.5"])("REPO_VITEST_TIMEOUT: throws on %j, which is no whole number of milliseconds", (value) => {
  vi.stubEnv("REPO_VITEST_TIMEOUT", value);
  expect(() => defineProject({})).toThrow(
    `@workerstack/repo/vitest: REPO_VITEST_TIMEOUT must be a whole number of milliseconds, got "${value}"`,
  );
});
