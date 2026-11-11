import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { plant, plantHomes, readGrok, readJsonDest, seedHome } from "./fixtures/purge-kit.ts";
import { purgeGlobalMcps } from "./purge-global-mcps.ts";
import { claudePluginsPath, cursorMcpPath, grokConfigPath } from "./purge-paths.ts";

const tmpDir = plantHomes();

it("purgeGlobalMcps dry-run leaves files unchanged", () => {
  const home = tmpDir("purge-mcp-dry-");
  const { grok, cursor } = seedHome(home);
  const grokBefore = fs.readFileSync(grok, "utf8");
  const cursorBefore = fs.readFileSync(cursor, "utf8");
  const r = purgeGlobalMcps({ apply: false, home });
  expect(r.ok).toBe(true);
  expect(r.report.every((row: { action: string }) => row.action === "dry-run")).toBe(true);
  expect(fs.readFileSync(grok, "utf8")).toBe(grokBefore);
  expect(fs.readFileSync(cursor, "utf8")).toBe(cursorBefore);
});

it("purgeGlobalMcps --apply removes cloudflare from enabled, adds disabled, drops MCP_DOCKER", () => {
  const home = tmpDir("purge-mcp-apply-");
  const { grok, cursor } = seedHome(home);
  const r = purgeGlobalMcps({ apply: true, home });
  expect(r.ok).toBe(true);
  expect(r.report.every((row: { action: string }) => row.action === "apply")).toBe(true);
  const parsed = readGrok(grok);
  expect(parsed.custom?.keep).toBe(true);
  expect(parsed.plugins?.enabled ?? []).not.toContain("cloudflare");
  expect(parsed.plugins?.enabled ?? []).not.toContain("stripe");
  expect(parsed.plugins?.disabled).toContain("cloudflare");
  expect(parsed.plugins?.disabled).toContain("stripe");
  expect(parsed.disabled_mcp_servers).toStrictEqual(
    expect.arrayContaining(["cloudflare-docs", "MCP_DOCKER", "stripe"]),
  );
  const mcp = readJsonDest(cursor);
  expect(mcp.mcpServers?.MCP_DOCKER).toBeUndefined();
  expect(mcp.mcpServers?.keep).toStrictEqual({ command: "x" });
  expect(fs.readFileSync(cursor, "utf8").endsWith("\n")).toBe(true);
});

it("purgeGlobalMcps missing cursor file: still succeeds only grok side changes", () => {
  const home = tmpDir("purge-mcp-nocursor-");
  const { grok, cursor } = seedHome(home, { cursor: false });
  expect(fs.existsSync(cursor)).toBe(false);
  const r = purgeGlobalMcps({ apply: true, home });
  expect(r.ok).toBe(true);
  expect(fs.existsSync(cursor)).toBe(false);
  const parsed = readGrok(grok);
  expect(parsed.plugins?.enabled ?? []).not.toContain("cloudflare");
  expect(parsed.plugins?.disabled).toContain("cloudflare");
  expect(r.report.some((row: { detail: string }) => /missing/.test(row.detail))).toBe(true);
});

it("purgeGlobalMcps unreadable toml fails without write", () => {
  const home = tmpDir("purge-mcp-unread-");
  const original = "<<<not-toml>>>\nkeep-this\n";
  const grok = plant(home, ".grok/config.toml", original);
  const r = purgeGlobalMcps({ apply: true, home });
  expect(r.ok).toBe(false);
  expect(fs.readFileSync(grok, "utf8")).toBe(original);
});

it("purgeGlobalMcps empties cursor mcpServers to {}", () => {
  const home = tmpDir("purge-mcp-empty-");
  plant(home, ".grok/config.toml", `[plugins]\nenabled = ["other"]\n`);
  const servers = JSON.stringify({ mcpServers: { MCP_DOCKER: { command: "docker" } } }, null, 2) + "\n";
  const cursor = plant(home, ".cursor/mcp.json", servers);
  expect(purgeGlobalMcps({ apply: true, home }).ok).toBe(true);
  expect(JSON.parse(fs.readFileSync(cursor, "utf8"))).toStrictEqual({ mcpServers: {} });
  expect(cursor).toBe(cursorMcpPath(home));
});

it("purgeGlobalMcps --apply removes stripe from enabled, adds disabled + disabled_mcp_servers; cloudflare unchanged", () => {
  const home = tmpDir("purge-mcp-stripe-");
  const grok = plant(
    home,
    ".grok/config.toml",
    `[custom]\nkeep = true\n\n[plugins]\nenabled = ["cloudflare", "stripe", "keep"]\ndisabled = ["cloudflare"]\n\ndisabled_mcp_servers = ["cloudflare-docs", "MCP_DOCKER"]\n`,
  );
  const r = purgeGlobalMcps({ apply: true, home });
  expect(r.ok).toBe(true);
  const parsed = readGrok(grok);
  expect(parsed.custom?.keep).toBe(true);
  expect(parsed.plugins?.enabled).toStrictEqual(["keep"]);
  expect(parsed.plugins?.disabled).toStrictEqual(["cloudflare", "stripe"]);
  expect(parsed.disabled_mcp_servers).toStrictEqual(["cloudflare-docs", "MCP_DOCKER", "stripe"]);
  expect(r.report.some((row: { detail: string }) => /stripe/.test(row.detail))).toBe(true);
});

/** A claude plugin list holding `keep@…` and `stripe@…`, the stripe one with a cache dir holding a marker. */
function plantClaude(home: string): { claude: string; cacheDir: string } {
  const claude = claudePluginsPath(home);
  const cacheDir = path.join(path.dirname(claude), "cache", "claude-plugins-official", "stripe", "0.6.2");
  plant(cacheDir, "marker", "keep");
  const plugins = {
    "keep@claude-plugins-official": [{ scope: "user" }],
    "stripe@claude-plugins-official": [{ installPath: cacheDir, scope: "user" }],
  };
  plant(home, ".claude/plugins/installed_plugins.json", JSON.stringify({ plugins, version: 2 }, null, 2) + "\n");
  return { cacheDir, claude };
}

it("purgeGlobalMcps removes stripe@ marketplace key from claude installed_plugins.json; leaves cache", () => {
  const home = tmpDir("purge-mcp-claude-");
  plant(home, ".grok/config.toml", `[plugins]\nenabled = ["other"]\n`);
  const { claude, cacheDir } = plantClaude(home);
  const r = purgeGlobalMcps({ apply: true, home });
  expect(r.ok).toBe(true);
  const parsed = readJsonDest(claude);
  expect(parsed.plugins?.["stripe@claude-plugins-official"]).toBeUndefined();
  expect(parsed.plugins?.["keep@claude-plugins-official"]).toStrictEqual([{ scope: "user" }]);
  expect(fs.readFileSync(path.join(cacheDir, "marker"), "utf8")).toBe("keep");
  expect(r.report.some((row: { path: string }) => row.path === claude)).toBe(true);
});

it("purgeGlobalMcps claude plugins missing: grok stripe still disabled", () => {
  const home = tmpDir("purge-mcp-noclaude-");
  const grok = plant(home, ".grok/config.toml", `[plugins]\nenabled = ["stripe"]\n`);
  expect(fs.existsSync(claudePluginsPath(home))).toBe(false);
  expect(purgeGlobalMcps({ apply: true, home }).ok).toBe(true);
  const parsed = readGrok(grok);
  expect(parsed.plugins?.enabled ?? []).not.toContain("stripe");
  expect(parsed.plugins?.disabled).toContain("stripe");
  expect(parsed.disabled_mcp_servers).toContain("stripe");
  expect(fs.existsSync(claudePluginsPath(home))).toBe(false);
  expect(grok).toBe(grokConfigPath(home));
});
