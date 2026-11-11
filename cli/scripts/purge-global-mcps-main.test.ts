import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { captureStreams, plant, plantHomes } from "./fixtures/purge-kit.ts";
import { main } from "./purge-global-mcps.ts";
import { resolveHome } from "./purge-paths.ts";

const tmpHome = plantHomes();

afterEach(() => vi.restoreAllMocks());

it("resolveHome with the process environment: reads HOME from the process when no env is passed", () => {
  vi.stubEnv("HOME", "/planted/home");
  expect(resolveHome()).toBe("/planted/home");
});

it("main: dry-run prints one line per file and writes nothing", () => {
  const home = tmpHome("purge-main-dry-");
  const grok = plant(home, ".grok/config.toml", `[plugins]\nenabled = ["cloudflare"]\n`);
  vi.stubEnv("HOME", home);
  const streams = captureStreams();
  expect(main([])).toBe(0);
  expect(streams.out().trim().split("\n")).toStrictEqual([
    `dry-run ${grok} remove cloudflare from [plugins].enabled; add cloudflare, stripe to [plugins].disabled; ` +
      "add cloudflare-docs, MCP_DOCKER, stripe to disabled_mcp_servers",
    `dry-run ${path.join(home, ".cursor", "mcp.json")} noop (missing)`,
    `dry-run ${path.join(home, ".claude", "plugins", "installed_plugins.json")} noop (missing)`,
  ]);
  expect(streams.err()).toBe("");
  expect(fs.readFileSync(grok, "utf8")).toContain('enabled = ["cloudflare"]');
});

it("main: --apply writes the purge and prints apply lines", () => {
  const home = tmpHome("purge-main-apply-");
  const cursor = plant(home, ".cursor/mcp.json", JSON.stringify({ mcpServers: { MCP_DOCKER: {} } }));
  vi.stubEnv("HOME", home);
  const streams = captureStreams();
  expect(main(["--apply"])).toBe(0);
  expect(streams.out()).toContain(`apply ${cursor} remove MCP_DOCKER from mcpServers`);
  expect(JSON.parse(fs.readFileSync(cursor, "utf8"))).toStrictEqual({ mcpServers: {} });
});

it("main: an unknown flag exits 1 with the reason on stderr and no stdout", () => {
  const streams = captureStreams();
  expect(main(["--wat"])).toBe(1);
  expect(streams.err()).toBe("unknown flag: --wat\n");
  expect(streams.out()).toBe("");
});

it("main: an unreadable file prints the error on stderr and exits 1", () => {
  const home = tmpHome("purge-main-bad-");
  const cursor = plant(home, ".cursor/mcp.json", "{");
  vi.stubEnv("HOME", home);
  const streams = captureStreams();
  expect(main([])).toBe(1);
  expect(streams.err()).toBe(`unreadable dest: ${cursor}\n`);
  expect(streams.out()).toBe("");
});

it("main: a failing stdout write exits 1 with the thrown message", () => {
  const home = tmpHome("purge-main-pipe-");
  vi.stubEnv("HOME", home);
  const streams = captureStreams();
  vi.spyOn(process.stdout, "write").mockImplementation(() => {
    throw new Error("EPIPE");
  });
  expect(main([])).toBe(1);
  expect(streams.err()).toBe("EPIPE\n");
});

it("main: reports a thrown non-Error value as text", () => {
  const home = tmpHome("purge-main-throw-");
  vi.stubEnv("HOME", home);
  const streams = captureStreams();
  vi.spyOn(process.stdout, "write").mockImplementation(() => {
    throw "closed";
  });
  expect(main([])).toBe(1);
  expect(streams.err()).toBe("closed\n");
});
