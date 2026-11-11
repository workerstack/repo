import fs from "node:fs";
import path from "node:path";

import { parse as parseToml } from "smol-toml";
import { expect, it } from "vitest";

import { plant, plantHomes } from "./fixtures/purge-kit.ts";
import { purgeGlobalMcps } from "./purge-global-mcps.ts";
import { claudePluginsPath, cursorMcpPath, grokConfigPath, parseArgv } from "./purge-paths.ts";

const tmpHome = plantHomes();

const GROK = ".grok/config.toml";
const CURSOR = ".cursor/mcp.json";
const CLAUDE = ".claude/plugins/installed_plugins.json";
const CLEAN_GROK = `disabled_mcp_servers = ["cloudflare-docs", "MCP_DOCKER", "stripe"]\n\n[plugins]\nenabled = []\ndisabled = ["cloudflare", "stripe"]\n`;

function reportOf(home: string, apply = false) {
  const r = purgeGlobalMcps({ apply, home });
  return { ...r, details: r.report.map((row) => row.detail) };
}

it("purgeGlobalMcps argument edges: fails without a home and reports no rows", () => {
  expect(purgeGlobalMcps({})).toStrictEqual({ error: "HOME required", ok: false, report: [] });
  expect(purgeGlobalMcps()).toStrictEqual({ error: "HOME required", ok: false, report: [] });
});

it("purgeGlobalMcps argument edges: parseArgv treats a non-list argv as no flags", () => {
  expect(parseArgv("--apply")).toStrictEqual({ apply: false, ok: true });
});

it("purgeGlobalMcps grok config: reports a missing file as noop and skips the write on apply", () => {
  const home = tmpHome("purge-grok-missing-");
  const r = reportOf(home, true);
  expect(r.ok).toBe(true);
  expect(r.details).toStrictEqual(["noop (missing)", "noop (missing)", "noop (missing)"]);
  expect(fs.existsSync(grokConfigPath(home))).toBe(false);
});

it("purgeGlobalMcps grok config: an unreadable path (a directory) fails as unreadable dest", () => {
  const home = tmpHome("purge-grok-dir-");
  fs.mkdirSync(grokConfigPath(home), { recursive: true });
  expect(purgeGlobalMcps({ home })).toMatchObject({ error: `unreadable dest: ${grokConfigPath(home)}`, ok: false });
});

it("purgeGlobalMcps grok config: a config that is already clean is a noop and apply leaves it byte-identical", () => {
  const home = tmpHome("purge-grok-clean-");
  const abs = plant(home, GROK, CLEAN_GROK);
  const r = reportOf(home, true);
  expect(r.details[0]).toBe("noop (already clean)");
  expect(fs.readFileSync(abs, "utf8")).toBe(CLEAN_GROK);
});

it("purgeGlobalMcps grok config: a config without [plugins] gets only the disabled_mcp_servers addition", () => {
  const home = tmpHome("purge-grok-noplugins-");
  const abs = plant(home, GROK, `title = "x"\n`);
  const r = reportOf(home, true);
  expect(r.details[0]).toBe(
    "add cloudflare, stripe to [plugins].disabled; add cloudflare-docs, MCP_DOCKER, stripe to disabled_mcp_servers",
  );
  const written = parseToml(fs.readFileSync(abs, "utf8"));
  expect(written).toEqual({
    disabled_mcp_servers: ["cloudflare-docs", "MCP_DOCKER", "stripe"],
    plugins: { disabled: ["cloudflare", "stripe"] },
    title: "x",
  });
});

it("purgeGlobalMcps grok config: only drops from enabled when disabled already holds both ids", () => {
  const home = tmpHome("purge-grok-enabled-only-");
  const abs = plant(
    home,
    GROK,
    `disabled_mcp_servers = ["cloudflare-docs", "MCP_DOCKER", "stripe"]\n[plugins]\nenabled = ["stripe", "keep"]\ndisabled = ["cloudflare", "stripe"]\n`,
  );
  const r = reportOf(home, true);
  expect(r.details[0]).toBe("remove stripe from [plugins].enabled");
  expect(parseToml(fs.readFileSync(abs, "utf8"))).toMatchObject({
    plugins: { disabled: ["cloudflare", "stripe"], enabled: ["keep"] },
  });
});

it("purgeGlobalMcps grok config: leaves a plugins table without enabled free of an enabled key", () => {
  const home = tmpHome("purge-grok-no-enabled-");
  const abs = plant(
    home,
    GROK,
    `disabled_mcp_servers = ["cloudflare-docs", "MCP_DOCKER", "stripe"]\n[plugins]\ndisabled = []\n`,
  );
  reportOf(home, true);
  expect(parseToml(fs.readFileSync(abs, "utf8")).plugins).toEqual({ disabled: ["cloudflare", "stripe"] });
});

it("purgeGlobalMcps grok config: skips disabled_mcp_servers when it is not a list", () => {
  const home = tmpHome("purge-grok-mcp-scalar-");
  plant(home, GROK, `disabled_mcp_servers = "all"\n[plugins]\nenabled = []\ndisabled = ["cloudflare", "stripe"]\n`);
  expect(reportOf(home).details[0]).toBe("noop (already clean)");
});

it("purgeGlobalMcps grok config: completes a partial disabled_mcp_servers list without duplicates", () => {
  const home = tmpHome("purge-grok-mcp-partial-");
  const abs = plant(
    home,
    GROK,
    `disabled_mcp_servers = ["stripe", "stripe", "mine"]\n[plugins]\nenabled = []\ndisabled = ["cloudflare", "stripe"]\n`,
  );
  expect(reportOf(home, true).details[0]).toBe("add cloudflare-docs, MCP_DOCKER to disabled_mcp_servers");
  expect(parseToml(fs.readFileSync(abs, "utf8")).disabled_mcp_servers).toStrictEqual([
    "stripe",
    "mine",
    "cloudflare-docs",
    "MCP_DOCKER",
  ]);
});

it.each([
  ["plugins is a scalar", `plugins = "x"\n`],
  ["plugins.enabled is not a list", `[plugins]\nenabled = "x"\n`],
  ["the toml does not parse", `[plugins\n`],
])("purgeGlobalMcps grok config: fails as unreadable dest when %s", (_name, body) => {
  const home = tmpHome("purge-grok-bad-");
  plant(home, GROK, body);
  expect(purgeGlobalMcps({ apply: true, home })).toMatchObject({
    error: `unreadable dest: ${grokConfigPath(home)}`,
    ok: false,
  });
});

it.each([
  ["not json", "{"],
  ["a list", "[]"],
  ["mcpServers a scalar", `{"mcpServers": 1}`],
])("purgeGlobalMcps cursor config: fails as unreadable dest when the file is %s", (_name, body) => {
  const home = tmpHome("purge-cursor-bad-");
  plant(home, CURSOR, body);
  expect(purgeGlobalMcps({ home })).toMatchObject({ error: `unreadable dest: ${cursorMcpPath(home)}`, ok: false });
});

it("purgeGlobalMcps cursor config: fails as unreadable dest when the path is a directory", () => {
  const home = tmpHome("purge-cursor-dir-");
  fs.mkdirSync(cursorMcpPath(home), { recursive: true });
  expect(purgeGlobalMcps({ home }).error).toBe(`unreadable dest: ${cursorMcpPath(home)}`);
});

it.each([
  ["has no mcpServers", `{"other": 1}`],
  ["has servers without MCP_DOCKER", `{"mcpServers": {"keep": {}}}`],
])("purgeGlobalMcps cursor config: is already clean when the file %s, and apply does not rewrite it", (_name, body) => {
  const home = tmpHome("purge-cursor-clean-");
  const abs = plant(home, CURSOR, body);
  expect(reportOf(home, true).details[1]).toBe("noop (already clean)");
  expect(fs.readFileSync(abs, "utf8")).toBe(body);
});

it.each([
  ["not json", "{"],
  ["a list", "[]"],
  ["plugins a scalar", `{"plugins": 1}`],
])("purgeGlobalMcps claude plugins: fails as unreadable dest when the file is %s", (_name, body) => {
  const home = tmpHome("purge-claude-bad-");
  plant(home, CLAUDE, body);
  expect(purgeGlobalMcps({ home })).toMatchObject({
    error: `unreadable dest: ${claudePluginsPath(home)}`,
    ok: false,
  });
});

it("purgeGlobalMcps claude plugins: fails as unreadable dest when the path is a directory", () => {
  const home = tmpHome("purge-claude-dir-");
  fs.mkdirSync(claudePluginsPath(home), { recursive: true });
  expect(purgeGlobalMcps({ home }).error).toBe(`unreadable dest: ${claudePluginsPath(home)}`);
});

it.each([
  ["has no plugins", `{"version": 2}`],
  ["has no stripe key", `{"plugins": {"other@market": []}}`],
])("purgeGlobalMcps claude plugins: is already clean when the file %s", (_name, body) => {
  const home = tmpHome("purge-claude-clean-");
  const abs = plant(home, CLAUDE, body);
  expect(reportOf(home, true).details[2]).toBe("noop (already clean)");
  expect(fs.readFileSync(abs, "utf8")).toBe(body);
});

it("purgeGlobalMcps claude plugins: an apply that fails on a later file leaves every file untouched", () => {
  const home = tmpHome("purge-atomic-");
  const grok = plant(home, GROK, `[plugins]\nenabled = ["cloudflare"]\n`);
  plant(home, CLAUDE, "{");
  const before = fs.readFileSync(grok, "utf8");
  expect(purgeGlobalMcps({ apply: true, home }).ok).toBe(false);
  expect(fs.readFileSync(grok, "utf8")).toBe(before);
  expect(path.basename(grok)).toBe("config.toml");
});
