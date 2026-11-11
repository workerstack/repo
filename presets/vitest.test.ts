import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { ViteUserConfig } from "vitest/config";

import { ShardSequencer } from "./shard-sequencer.ts";
import { rootPath } from "./temp-root-env.ts";
import { defineConfig, defineProject } from "./vitest.ts";

const platform = process.platform;
const cwd = process.cwd();
const temps: string[] = [];
const NO_FLOORS = { floors: "no-such-floors.json" };
const FLOOR = { branches: 70, functions: 90, lines: 85, statements: 80 };

/** A temp dir holding `files` (name to text), removed after the test. */
function plant(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "workerstack-preset-"));
  temps.push(dir);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

/** The per-file thresholds a config carries for its coverage. */
function thresholds({ test }: ViteUserConfig): unknown {
  return test?.coverage !== undefined && "thresholds" in test.coverage ? test.coverage.thresholds : undefined;
}

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { configurable: true, enumerable: true, value });
}

afterEach(() => {
  setPlatform(platform);
  process.chdir(cwd);
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

describe("defineProject", () => {
  it.each([
    ["win32", 60_000],
    ["linux", 5_000],
  ] as const)("on %s gives %d ms timeouts and the forks pool", (os, ms) => {
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

  it("keeps a timeout the caller passes", () => {
    setPlatform("linux");
    expect(defineProject({ test: { testTimeout: 1_234 } }).test).toMatchObject({
      hookTimeout: 5_000,
      testTimeout: 1_234,
    });
  });

  it("keeps an include the caller passes", () => {
    expect(defineProject({ test: { include: ["src/**/*.test.ts"] } }).test?.include).toStrictEqual([
      "src/**/*.test.ts",
    ]);
  });
});

describe("defineConfig", () => {
  it("adds istanbul coverage to the project defaults", () => {
    setPlatform("linux");
    const { test } = defineConfig({}, NO_FLOORS);
    expect(test).toMatchObject({
      coverage: { provider: "istanbul" },
      deps: { interopDefault: false },
      hookTimeout: 5_000,
      pool: "forks",
      testTimeout: 5_000,
    });
  });

  it("keeps the caller's include and coverage settings", () => {
    setPlatform("win32");
    const config = defineConfig(
      { test: { coverage: { include: ["src/**"] }, include: ["src/**/*.test.ts"] } },
      NO_FLOORS,
    );
    expect(config.test).toMatchObject({
      coverage: { include: ["src/**"], provider: "istanbul" },
      include: ["src/**/*.test.ts"],
      testTimeout: 60_000,
    });
  });
});

describe("defineConfig sequencer", () => {
  it("shards by measured time, and lets the caller's sequencer win", () => {
    expect(defineConfig({}, NO_FLOORS).test?.sequence?.sequencer).toBe(ShardSequencer);
    class Mine extends ShardSequencer {}
    expect(defineConfig({ test: { sequence: { sequencer: Mine } } }, NO_FLOORS).test?.sequence?.sequencer).toBe(Mine);
  });
});

describe("defineConfig floors", () => {
  it("turns coverage-floors.json in the cwd into per-file thresholds beside the caller's", () => {
    process.chdir(plant({ "coverage-floors.json": JSON.stringify({ "src/a.ts": FLOOR }) }));
    const config = defineConfig({ test: { coverage: { thresholds: { "src/b.ts": { lines: 100 } } } } });
    expect(thresholds(config)).toStrictEqual({ "src/a.ts": FLOOR, "src/b.ts": { lines: 100 } });
  });

  it("adds no thresholds when the cwd has no floors file", () => {
    process.chdir(plant({}));
    expect(thresholds(defineConfig({}))).toBeUndefined();
  });

  it("reads the floors file it is given instead of the default", () => {
    const dir = plant({ "coverage-floors.json": "{}", "ratchet.json": JSON.stringify({ "src/c.ts": FLOOR }) });
    process.chdir(dir);
    const given = defineConfig({}, { floors: path.join(dir, "ratchet.json") });
    expect(thresholds(given)).toStrictEqual({ "src/c.ts": FLOOR });
    expect(thresholds(defineConfig({}, { floors: "ratchet.json" }))).toStrictEqual({ "src/c.ts": FLOOR });
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
    expect(thresholds(config)).toStrictEqual({ "src/a.ts": { ...FLOOR, lines: 100 } });
  });
});

describe("defineConfig Rust rows", () => {
  it("keeps only the TypeScript rows as thresholds, leaving the Rust ones to repo ci", () => {
    const rust = { functions: 66, lines: 66, regions: 58 };
    process.chdir(plant({ "coverage-floors.json": JSON.stringify({ "a/src/lib.rs": rust, "src/a.ts": FLOOR }) }));
    expect(thresholds(defineConfig({}))).toStrictEqual({ "src/a.ts": FLOOR });
  });

  it("adds no thresholds when the floors file holds only Rust rows", () => {
    const rust = { functions: 66, lines: 66, regions: 58 };
    process.chdir(plant({ "coverage-floors.json": JSON.stringify({ "a/src/lib.rs": rust }) }));
    expect(thresholds(defineConfig({}))).toBeUndefined();
  });

  it("names a floors file with a bad row", () => {
    const dir = plant({ "coverage-floors.json": JSON.stringify({ "src/a.ts": { lines: 1 } }) });
    process.chdir(dir);
    expect(() => defineConfig({})).toThrow("src/a.ts has a bad floor row");
  });
});

const WRANGLER_FILES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"] as const;
const usage = (file: string) =>
  `@workerstack/repo/vitest: ${file} is here, so tests run in the Workers runtime; bun add -d @cloudflare/vitest-plugin`;

/** A temp root holding `file`, an empty wrangler file. */
const plantWorker = (file: string) => plant({ [file]: "" });

/** The messages the config's plugin promises reject with; this repo does not install the plugin. */
async function rejections({ plugins }: ViteUserConfig): Promise<string[]> {
  const settled = await Promise.allSettled(plugins ?? []);
  return settled.map((result) => (result.status === "rejected" ? String(result.reason.message) : "resolved"));
}

describe("defineConfig temp root guard", () => {
  it("runs the guard first, then the caller's global setups, and inlines zod for it", () => {
    const config = defineConfig({ test: { globalSetup: ["mine.ts"] } }, NO_FLOORS);
    const [guard, ...rest] = [config.test?.globalSetup].flat();
    expect(rest).toStrictEqual(["mine.ts"]);
    expect(path.basename(String(guard))).toMatch(/^temp-root\.(ts|js)$/);
    expect(fs.existsSync(String(guard))).toBe(true);
    expect(config.test?.server?.deps?.inline).toContain("zod");
  });

  it("gives test processes the run root as their temp dir, under the caller's own env", () => {
    const root = rootPath();
    const env = defineConfig({ test: { env: { MINE: "1", TMP: "/mine" } } }, NO_FLOORS).test?.env;
    expect(env).toMatchObject({ MINE: "1", TEMP: root, TMP: "/mine", TMPDIR: root });
    expect(defineConfig({}, NO_FLOORS).test?.env?.TMP).toBe(root);
  });
});

describe.each([
  ["defineConfig", (config: ViteUserConfig) => defineConfig(config, NO_FLOORS)],
  ["defineProject", (config: ViteUserConfig) => defineProject(config)],
] as const)("%s in a Worker package", (_name, define) => {
  it.each(WRANGLER_FILES)("with %s adds a plugin promise and drops the forks pool", async (file) => {
    const config = define({ test: { root: plantWorker(file) } });
    expect(config.plugins).toStrictEqual([expect.any(Promise)]);
    expect(config.test?.pool).toBeUndefined();
    expect(await rejections(config)).toStrictEqual([usage(file)]);
  });

  it("adds neither without a wrangler file", () => {
    const config = define({ test: { root: plant({}) } });
    expect(config.plugins).toBeUndefined();
    expect(config.test?.pool).toBe("forks");
  });

  it("finds the wrangler file in the root while the cwd is elsewhere, from test.root or root", async () => {
    const dir = plantWorker("wrangler.json");
    process.chdir(plant({}));
    const named = [define({ test: { root: dir } }), define({ root: dir })];
    const settled = await Promise.all(named.map(rejections));
    expect(settled).toStrictEqual([[usage("wrangler.json")], [usage("wrangler.json")]]);
  });

  it("uses the cwd as the root when the config names none", async () => {
    process.chdir(plantWorker("wrangler.toml"));
    expect(await rejections(define({}))).toStrictEqual([usage("wrangler.toml")]);
  });

  it("keeps the caller's plugins and pool", async () => {
    const test = { pool: "threads", root: plantWorker("wrangler.jsonc") } as const;
    const config = define({ plugins: [{ name: "mine" }], test });
    expect(config.test?.pool).toBe("threads");
    expect(await rejections(config)).toStrictEqual([usage("wrangler.jsonc"), "resolved"]);
  });
});
