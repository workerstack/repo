import { expect, it, vi } from "vitest";
import type { UserWorkspaceConfig, ViteUserConfig } from "vitest/config";

import { defineConfig, defineProject } from "./vitest.ts";

/** The `test` options of a config as the root config types them, for the run options the project type leaves out. */
function testOf(config: UserWorkspaceConfig): NonNullable<ViteUserConfig["test"]> {
  return { ...config.test };
}

it("defineProject: leaves coverage and reporters alone when neither variable is set", () => {
  vi.stubEnv("REPO_COVERAGE", "");
  vi.stubEnv("REPO_VITEST_REPORT", "");
  const test = testOf(defineProject({}));
  expect(test).not.toHaveProperty("coverage");
  expect(test).not.toHaveProperty("reporters");
});

it("defineProject: REPO_COVERAGE=1 enables istanbul coverage, and keeps a provider the caller names", () => {
  vi.stubEnv("REPO_COVERAGE", "1");
  expect(testOf(defineProject({})).coverage).toStrictEqual({ enabled: true, provider: "istanbul" });
  const rootOptions = { coverage: { provider: "v8" } }; // root options the project type leaves out
  const own = { test: { name: "own", ...rootOptions } };
  expect(testOf(defineProject(own)).coverage).toMatchObject({ enabled: true, provider: "v8" });
});

it("defineProject: REPO_COVERAGE=0 turns coverage off, even where the caller's config turns it on", () => {
  vi.stubEnv("REPO_COVERAGE", "0");
  expect(testOf(defineProject({})).coverage).toMatchObject({ enabled: false });
  expect(testOf(defineProject({ test: { name: "x" } })).coverage).toMatchObject({ enabled: false });
});

it.each(["false", "yes"])("defineProject: REPO_COVERAGE=%s leaves coverage alone", (value) => {
  vi.stubEnv("REPO_COVERAGE", value);
  expect(testOf(defineProject({}))).not.toHaveProperty("coverage");
});

it("defineProject: REPO_VITEST_REPORT adds the json reporter and its output file", () => {
  vi.stubEnv("REPO_VITEST_REPORT", ".turbo/vitest-report.json");
  const test = testOf(defineProject({}));
  expect(test.reporters).toStrictEqual(["default", "json"]);
  expect(test.outputFile).toStrictEqual({ json: ".turbo/vitest-report.json" });
});

it("defineProject: reads the variables per call, not at load", () => {
  vi.stubEnv("REPO_VITEST_REPORT", undefined);
  expect(testOf(defineProject({}))).not.toHaveProperty("outputFile");
  vi.stubEnv("REPO_VITEST_REPORT", "r.json");
  expect(testOf(defineProject({})).outputFile).toStrictEqual({ json: "r.json" });
});

/** A floors file no test writes, so `defineConfig` reads no floors. */
const NO_FLOORS = { floors: "no-such-floors.json" };

it("REPO_VITEST_EXCLUDE adds its globs to vitest's default excludes in both configs", () => {
  vi.stubEnv("REPO_VITEST_EXCLUDE", '["a.test.ts"]');

  for (const test of [defineConfig({}, NO_FLOORS).test, testOf(defineProject({}))]) {
    expect(test?.exclude).toContain("a.test.ts");
    expect(test?.exclude).toContain("**/node_modules/**");
  }
});

it("REPO_VITEST_EXCLUDE keeps the caller's own excludes", () => {
  vi.stubEnv("REPO_VITEST_EXCLUDE", '["a.test.ts"]');
  const own = { test: { exclude: ["own/**"] } };
  expect(defineConfig(own, NO_FLOORS).test?.exclude).toStrictEqual(expect.arrayContaining(["own/**", "a.test.ts"]));
  expect(testOf(defineProject(own)).exclude).toStrictEqual(expect.arrayContaining(["own/**", "a.test.ts"]));
});

it.each([undefined, ""])("REPO_VITEST_EXCLUDE=%s adds no exclude", (value) => {
  vi.stubEnv("REPO_VITEST_EXCLUDE", value);
  expect(defineConfig({}, NO_FLOORS).test).not.toHaveProperty("exclude");
  expect(testOf(defineProject({}))).not.toHaveProperty("exclude");
});

it.each(["nope", "[1]", '{"a":1}'])("REPO_VITEST_EXCLUDE=%s throws and names the value", (value) => {
  vi.stubEnv("REPO_VITEST_EXCLUDE", value);
  const message = `@workerstack/repo/vitest: REPO_VITEST_EXCLUDE must be a JSON list of globs, got "${value}"`;
  expect(() => defineConfig({}, NO_FLOORS)).toThrow(message);
  expect(() => defineProject({})).toThrow(message);
});
