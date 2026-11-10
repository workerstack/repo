import { expect, it, vi } from "vitest";
import type { UserWorkspaceConfig } from "vitest/config";
import { defineProject } from "./vitest.ts";

/** The `test` options of a config as a plain record, for the root options its type leaves out. */
const testOf = (config: UserWorkspaceConfig): Record<string, unknown> => ({ ...config.test });

it("defineProject: leaves coverage and reporters alone when neither variable is set", () => {
  vi.stubEnv("REPO_COVERAGE", "");
  vi.stubEnv("REPO_VITEST_REPORT", "");
  const test = testOf(defineProject({}));
  expect(test).not.toHaveProperty("coverage");
  expect(test).not.toHaveProperty("reporters");
});

it("defineProject: REPO_COVERAGE=1 enables istanbul coverage, and keeps a provider the caller names", () => {
  vi.stubEnv("REPO_COVERAGE", "1");
  expect(testOf(defineProject({})).coverage).toEqual({ provider: "istanbul", enabled: true });
  const rootOptions = { coverage: { provider: "v8" } }; // root options the project type leaves out
  const own = { test: { name: "own", ...rootOptions } };
  expect(testOf(defineProject(own)).coverage).toMatchObject({ provider: "v8", enabled: true });
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
  expect(test.reporters).toEqual(["default", "json"]);
  expect(test.outputFile).toEqual({ json: ".turbo/vitest-report.json" });
});

it("defineProject: reads the variables per call, not at load", () => {
  expect(testOf(defineProject({}))).not.toHaveProperty("outputFile");
  vi.stubEnv("REPO_VITEST_REPORT", "r.json");
  expect(testOf(defineProject({})).outputFile).toEqual({ json: "r.json" });
});
