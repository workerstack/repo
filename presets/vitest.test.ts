import { afterEach, describe, expect, it } from "vitest";
import { defineConfig, defineProject } from "./vitest.ts";

const platform = process.platform;

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value, configurable: true, enumerable: true });
}

afterEach(() => setPlatform(platform));

describe("defineProject", () => {
  it.each([
    ["win32", 60_000],
    ["linux", 5_000],
  ] as const)("on %s gives %d ms timeouts and the forks pool", (os, ms) => {
    setPlatform(os);
    expect(defineProject({})).toEqual({ test: { testTimeout: ms, hookTimeout: ms, pool: "forks", deps: { interopDefault: false } } });
  });

  it("keeps a timeout the caller passes", () => {
    setPlatform("linux");
    expect(defineProject({ test: { testTimeout: 1_234 } }).test).toMatchObject({
      testTimeout: 1_234,
      hookTimeout: 5_000,
    });
  });

  it("keeps an include the caller passes", () => {
    expect(defineProject({ test: { include: ["src/**/*.test.ts"] } }).test?.include).toEqual(["src/**/*.test.ts"]);
  });
});

describe("defineConfig", () => {
  it("adds istanbul coverage to the project defaults", () => {
    setPlatform("linux");
    expect(defineConfig({})).toEqual({
      test: { testTimeout: 5_000, hookTimeout: 5_000, pool: "forks", deps: { interopDefault: false }, coverage: { provider: "istanbul" } },
    });
  });

  it("keeps the caller's include and coverage settings", () => {
    setPlatform("win32");
    const config = defineConfig({
      test: { include: ["src/**/*.test.ts"], coverage: { include: ["src/**"] } },
    });
    expect(config.test).toMatchObject({
      include: ["src/**/*.test.ts"],
      testTimeout: 60_000,
      coverage: { provider: "istanbul", include: ["src/**"] },
    });
  });
});
