import { describe, expect, it } from "vitest";

import { workersPlugin } from "./workers-plugin.ts";

const CONFIG_PATH = "/project/wrangler.toml";
const USAGE =
  "@workerstack/repo/vitest: wrangler.toml is here, so tests run in the Workers runtime; bun add -d @cloudflare/vitest-plugin";

/** An error as node gives it: a message and a `code`. */
function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const failing = (error: unknown) => () => Promise.reject(error);

describe("workersPlugin, a module", () => {
  it("resolves to what cloudflareTest returns for the wrangler file", async () => {
    const cloudflareTest = (options: unknown) => ({ name: "cloudflare-test", options });
    const plugin = await workersPlugin(CONFIG_PATH, () => Promise.resolve({ cloudflareTest }));
    expect(plugin).toStrictEqual({ name: "cloudflare-test", options: { wrangler: { configPath: CONFIG_PATH } } });
  });

  it.each([
    ["a module without cloudflareTest", { other: 1 }],
    ["a cloudflareTest that is not a function", { cloudflareTest: 1 }],
    ["a module that is not an object", "text"],
    ["a null module", null],
  ])("names the expected range for %s", async (_name, loaded) => {
    await expect(workersPlugin(CONFIG_PATH, () => Promise.resolve(loaded))).rejects.toThrow(
      "@workerstack/repo/vitest: @cloudflare/vitest-plugin does not export cloudflareTest; bun add -d @cloudflare/vitest-plugin@^1.6.0",
    );
  });
});

describe("workersPlugin, a failed load", () => {
  it("says how to install a plugin node or bun cannot find, naming the wrangler file", async () => {
    const error = coded("ERR_MODULE_NOT_FOUND", "Cannot find package '@cloudflare/vitest-plugin' imported from x");
    await expect(workersPlugin(CONFIG_PATH, failing(error))).rejects.toThrow(new Error(USAGE));
  });

  it("says how to install a plugin the vitest runner cannot resolve", async () => {
    const error = new Error(
      'Could not resolve "@cloudflare/vitest-plugin" imported by "@workerstack/repo". Is it installed?',
    );
    await expect(workersPlugin(CONFIG_PATH, failing(error))).rejects.toThrow(new Error(USAGE));
  });

  it("passes on a missing package that is not the plugin, unchanged", async () => {
    const error = coded("ERR_MODULE_NOT_FOUND", "Cannot find package 'esbuild' imported from the plugin");
    await expect(workersPlugin(CONFIG_PATH, failing(error))).rejects.toBe(error);
  });

  it.each([
    ["an error the plugin throws while loading", new Error("boom")],
    [
      "an error that names the plugin without being a missing one",
      coded("EACCES", "@cloudflare/vitest-plugin: denied"),
    ],
    ["a value that is not an error", "plain"],
  ])("passes on %s, unchanged", async (_name, error) => {
    await expect(workersPlugin(CONFIG_PATH, failing(error))).rejects.toBe(error);
  });
});
