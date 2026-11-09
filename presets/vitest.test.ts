import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteUserConfig } from "vitest/config";
import { defineConfig, defineProject } from "./vitest.ts";

const platform = process.platform;
const cwd = process.cwd();
const temps: string[] = [];
const NO_FLOORS = { floors: "no-such-floors.json" };
const FLOOR = { statements: 80, branches: 70, functions: 90, lines: 85 };

/** A temp dir holding `files` (name to text), removed after the test. */
function plant(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "workerstack-preset-"));
  temps.push(dir);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

/** The per-file thresholds a config carries for its coverage. */
function thresholds({ test }: ViteUserConfig): unknown {
  return test?.coverage !== undefined && "thresholds" in test.coverage ? test.coverage.thresholds : undefined;
}

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value, configurable: true, enumerable: true });
}

afterEach(() => {
  setPlatform(platform);
  process.chdir(cwd);
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("defineProject", () => {
  it.each([
    ["win32", 60_000],
    ["linux", 5_000],
  ] as const)("on %s gives %d ms timeouts and the forks pool", (os, ms) => {
    setPlatform(os);
    expect(defineProject({})).toEqual({
      test: { testTimeout: ms, hookTimeout: ms, pool: "forks", deps: { interopDefault: false } },
    });
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
    expect(defineConfig({}, NO_FLOORS)).toEqual({
      test: {
        testTimeout: 5_000,
        hookTimeout: 5_000,
        pool: "forks",
        deps: { interopDefault: false },
        coverage: { provider: "istanbul" },
      },
    });
  });

  it("keeps the caller's include and coverage settings", () => {
    setPlatform("win32");
    const config = defineConfig(
      { test: { include: ["src/**/*.test.ts"], coverage: { include: ["src/**"] } } },
      NO_FLOORS,
    );
    expect(config.test).toMatchObject({
      include: ["src/**/*.test.ts"],
      testTimeout: 60_000,
      coverage: { provider: "istanbul", include: ["src/**"] },
    });
  });
});

describe("defineConfig floors", () => {
  it("turns coverage-floors.json in the cwd into per-file thresholds beside the caller's", () => {
    process.chdir(plant({ "coverage-floors.json": JSON.stringify({ "src/a.ts": FLOOR }) }));
    const config = defineConfig({ test: { coverage: { thresholds: { "src/b.ts": { lines: 100 } } } } });
    expect(thresholds(config)).toEqual({ "src/a.ts": FLOOR, "src/b.ts": { lines: 100 } });
  });

  it("adds no thresholds when the cwd has no floors file", () => {
    process.chdir(plant({}));
    expect(thresholds(defineConfig({}))).toBeUndefined();
  });

  it("reads the floors file it is given instead of the default", () => {
    const dir = plant({ "coverage-floors.json": "{}", "ratchet.json": JSON.stringify({ "src/c.ts": FLOOR }) });
    process.chdir(dir);
    const given = defineConfig({}, { floors: path.join(dir, "ratchet.json") });
    expect(thresholds(given)).toEqual({ "src/c.ts": FLOOR });
    expect(thresholds(defineConfig({}, { floors: "ratchet.json" }))).toEqual({ "src/c.ts": FLOOR });
  });

  it("names a floors file that is not JSON", () => {
    const dir = plant({ "coverage-floors.json": "{ nope" });
    expect(() => defineConfig({}, { floors: path.join(dir, "coverage-floors.json") })).toThrow(
      `${path.join(dir, "coverage-floors.json")} is not valid JSON`,
    );
  });

  it("lets the caller's threshold for a file win over its floor", () => {
    process.chdir(plant({ "coverage-floors.json": JSON.stringify({ "src/a.ts": FLOOR }) }));
    const config = defineConfig({ test: { coverage: { thresholds: { "src/a.ts": { lines: 100 } } } } });
    expect(thresholds(config)).toEqual({ "src/a.ts": { ...FLOOR, lines: 100 } });
  });
});
