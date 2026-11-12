/**
 * The published vitest preset, end to end: a packed consumer installs it from the registry beside vitest 5, the
 * Workers plugin and wrangler, and runs `bun --bun vitest` the way a user does. A Worker package's tests run in
 * workerd under a path floor; a leaked temp file fails the run; a missing plugin says how to install it.
 */
import fs from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, inject, it } from "vitest";

import { PACKAGE_NAME } from "./registry";
import { Sandbox } from "./sandbox";
import { tail } from "./tail";

const version = inject("version");
const VITEST_RANGE = "^5.1.0";
const PLUGIN = "@cloudflare/vitest-plugin";
const FAILED = 1;
const NO_COLOR = { NO_COLOR: "1" };

const NO_PLUGIN_LINE =
  "@workerstack/repo/vitest: wrangler.jsonc is here, so tests run in the Workers runtime; " +
  "bun add -d @cloudflare/vitest-plugin";

const LEAK_LINE = "Error: tests left 1 entry in the run's temp root: leaked-dir; remove each in the test that made it";

const CONFIG = `import { defineConfig } from "@workerstack/repo/vitest";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], coverage: { include: ["src/index.ts"] } },
});
`;

const FLOOR = { branches: 100, functions: 100, lines: 100, statements: 100 };

const WORKER =
  "export default {\n  async fetch(): Promise<Response> {\n" +
  '    return new Response("hello from the worker");\n  },\n};\n';

const WORKER_TEST = `import { describe, expect, it } from "vitest";
import worker from "./index.ts";

describe("the worker", () => {
  it("runs in the Workers runtime", () => {
    expect(navigator.userAgent).toBe("Cloudflare-Workers");
  });

  it("answers a request", async () => {
    const response = await worker.fetch(new Request("http://example.com/"));
    expect(await response.text()).toBe("hello from the worker");
  });
});
`;

const WRANGLER = `{
  "name": "consumer",
  "main": "src/index.ts",
  "compatibility_date": "2025-09-01",
  "compatibility_flags": ["nodejs_compat"]
}
`;

const LEAK_TEST = `import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("leaves a directory in the temp root", () => {
  fs.mkdirSync(path.join(os.tmpdir(), "leaked-dir"));
  expect(1).toBe(1);
});
`;

/** A consumer that installs this build and vitest 5 from the registry, plus `extra` dependencies. */
async function consumer(name: string, extra: Record<string, string>): Promise<Sandbox> {
  const sb = new Sandbox(name);
  await sb.scaffold({
    // Listed in the order the package.json has always been written in.
    devDependencies: Object.fromEntries([
      [PACKAGE_NAME, version],
      ["vitest", VITEST_RANGE],
      ["@vitest/coverage-istanbul", VITEST_RANGE],
      ...Object.entries(extra),
    ]),
    type: "module",
  });
  sb.write("vitest.config.ts", CONFIG);
  sb.expectOk(await sb.run("bun", ["install"]));

  return sb;
}

describe("a Worker package", () => {
  let sb: Sandbox;

  beforeAll(async () => {
    sb = await consumer("preset-worker", { [PLUGIN]: "^1.6.0", wrangler: "^4.0.0" });
    sb.write("wrangler.jsonc", WRANGLER);
    sb.write("src/index.ts", WORKER);
    sb.write("src/index.test.ts", WORKER_TEST);
    sb.write("coverage-floors.json", `${JSON.stringify({ "src/index.ts": FLOOR })}\n`);
  });

  it.each([[[]], [["--coverage"]]])(
    "runs its tests in workerd and exits 0 with no temp leak, with %j",
    async (flags) => {
      const run = await sb.run("bun", ["--bun", "vitest", "run", ...flags], { env: NO_COLOR });
      expect(run.status, tail(run.out)).toBe(0);
      expect(run.out).toMatch(/Tests\s+2 passed/);
      expect(run.out).not.toContain("tests left");
    },
  );

  it("says how to install the plugin once it is gone, and exits 1", async () => {
    fs.rmSync(path.join(sb.repo, "node_modules", ...PLUGIN.split("/")), { recursive: true });
    const run = await sb.run("bun", ["--bun", "vitest", "run"], { env: NO_COLOR });
    expect(run.status, tail(run.out)).toBe(FAILED);
    expect(run.out).toContain(NO_PLUGIN_LINE);
  });
});

describe("a package without wrangler", () => {
  it("fails a run whose test leaves a file in the temp root, and says which", async () => {
    const sb = await consumer("preset-leak", {});
    sb.write("src/leak.test.ts", LEAK_TEST);
    const run = await sb.run("bun", ["--bun", "vitest", "run"], { env: NO_COLOR });
    expect(run.status, tail(run.out)).toBe(FAILED);
    expect(run.out).toContain(LEAK_LINE);
  });
});
