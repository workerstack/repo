import { expect, it, vi } from "vitest";
import type { UserWorkspaceConfig, ViteUserConfig } from "vitest/config";

import { defineProject } from "./vitest.ts";

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
