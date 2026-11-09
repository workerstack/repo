import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { emitMcpPolicy } from "./emit-mcp-policy.ts";
import { DENY_ALL, changeJson, changeToml, plantDirs, plantPolicy } from "./fixtures/mcp-policy-kit.ts";

const tmp = plantDirs();

const GROK = ".grok/config.toml";
const CLAUDE = ".claude/settings.json";
const MCP = ".mcp.json";
const CODEX = ".codex/config.toml";
const AGENTS = ".agents/mcp_config.json";

const ALLOW_A = { ...DENY_ALL, allow: ["a"], servers: { a: { url: "u" } } };

/** A workspace emitted from `policy`, with the home passed so no real dotfile is consulted. */
function emitted(policy: unknown = DENY_ALL) {
  const ws = tmp("mcp-check-ws-");
  const home = tmp("mcp-check-home-");
  plantPolicy(ws, policy);
  expect(emitMcpPolicy({ workspaceRoot: ws, home }).ok).toBe(true);
  return { ws, check: () => emitMcpPolicy({ workspaceRoot: ws, home, check: true }) };
}

function driftOf(result: ReturnType<typeof emitMcpPolicy>): string[] {
  return result.drift ?? [];
}

it("emitMcpPolicy --check: passes on a fresh emit and writes nothing", () => {
  const { ws, check } = emitted(ALLOW_A);
  const before = fs.readFileSync(path.join(ws, GROK), "utf8");
  expect(check()).toEqual({ ok: true, check: true, drift: [] });
  expect(fs.readFileSync(path.join(ws, GROK), "utf8")).toBe(before);
});

it("emitMcpPolicy --check: lists every missing file as drift in one error", () => {
  const ws = tmp("mcp-check-empty-");
  plantPolicy(ws, DENY_ALL);
  expect(emitMcpPolicy({ workspaceRoot: ws, home: tmp("mcp-check-home-"), check: true })).toEqual({
    ok: false,
    check: true,
    error: `drift: ${[GROK, CLAUDE, MCP, CODEX, AGENTS].join(", ")}`,
    drift: [GROK, CLAUDE, MCP, CODEX, AGENTS],
  });
});

const GROK_CASES: [string, string[], unknown][] = [
  ["a features table", ["features"], { x: 1 }],
  ["a permissions list", ["permissions"], [1]],
  ["plugins.deny_default", ["plugins", "deny_default"], true],
  ["mcp.servers", ["mcp"], { servers: { x: {} } }],
  ["no MCPTool deny", ["permission", "deny"], []],
  ["no permission table", ["permission"], undefined],
  ["plugins still enabled", ["plugins", "enabled"], ["x"]],
];

it.each(GROK_CASES)("--check grok drift: flags %s", (_name, keyPath, value) => {
  const { ws, check } = emitted();
  changeToml(ws, GROK, keyPath, value);
  expect(driftOf(check())).toEqual([GROK]);
});

const GROK_ALLOW_CASES: [string, string[], unknown][] = [
  ["a missing MCPTool allow", ["permission", "allow"], []],
  ["no allow list", ["permission", "allow"], undefined],
  ["a missing server table", ["mcp_servers"], undefined],
  ["a changed server spec", ["mcp_servers", "a", "url"], "other"],
];

it.each(GROK_ALLOW_CASES)("--check grok drift: flags %s for an allowed server", (_name, keyPath, value) => {
  const { ws, check } = emitted(ALLOW_A);
  changeToml(ws, GROK, keyPath, value);
  expect(driftOf(check())).toEqual([GROK]);
});

it("--check grok drift: accepts extra disk keys beyond the desired ones", () => {
  const { ws, check } = emitted(ALLOW_A);
  changeToml(ws, GROK, ["extra"], 1);
  changeToml(ws, GROK, ["mcp_servers", "a", "more"], true);
  expect(check().ok).toBe(true);
});

it("--check grok drift: does not require plugins to be emptied when the policy does not deny them", () => {
  const { ws, check } = emitted({ ...DENY_ALL, plugins: {} });
  changeToml(ws, GROK, ["plugins"], { enabled: ["x"] });
  expect(check().ok).toBe(true);
});

it("--check grok drift: keeps a home [features] table and only checks the rest", () => {
  const ws = tmp("mcp-check-home-ws-");
  plantPolicy(ws, DENY_ALL);
  expect(emitMcpPolicy({ workspaceRoot: ws, home: ws }).ok).toBe(true);
  changeToml(ws, GROK, ["features"], { x: 1 });
  expect(emitMcpPolicy({ workspaceRoot: ws, home: ws, check: true }).ok).toBe(true);
});

const CLAUDE_CASES: [string, string[], unknown][] = [
  ["project MCP servers enabled", ["enableAllProjectMcpServers"], true],
  ["a different enabled list", ["enabledMcpjsonServers"], ["x"]],
  ["no mcp__* deny", ["permissions", "deny"], []],
  ["no permissions", ["permissions"], undefined],
  ["a deny that is not a list", ["permissions", "deny"], "mcp__*"],
];

it.each(CLAUDE_CASES)("--check claude drift: flags %s", (_name, keyPath, value) => {
  const { ws, check } = emitted();
  changeJson(ws, CLAUDE, keyPath, value);
  expect(driftOf(check())).toEqual([CLAUDE]);
});

it("--check mcp json and agents drift: flags a changed .mcp.json and .agents/mcp_config.json", () => {
  const { ws, check } = emitted(ALLOW_A);
  changeJson(ws, MCP, ["mcpServers", "a", "url"], "other");
  changeJson(ws, AGENTS, ["extra"], 1);
  expect(driftOf(check())).toEqual([MCP, AGENTS]);
});

it("--check codex drift: flags a dropped max_depth but accepts a depth the user chose", () => {
  const { ws, check } = emitted();
  changeToml(ws, CODEX, ["agents", "max_depth"], 3);
  expect(check().ok).toBe(true);
  changeToml(ws, CODEX, ["agents", "max_depth"], undefined);
  expect(driftOf(check())).toEqual([CODEX]);
});

it("--check codex drift: flags a changed mcp_servers table when servers are allowed", () => {
  const { ws, check } = emitted(ALLOW_A);
  changeToml(ws, CODEX, ["mcp_servers", "a", "url"], "other");
  expect(driftOf(check())).toEqual([CODEX]);
});

it("--check codex drift: flags a leftover mcp_servers table when nothing is allowed", () => {
  const { ws, check } = emitted();
  changeToml(ws, CODEX, ["mcp_servers"], { old: { command: "o" } });
  expect(driftOf(check())).toEqual([CODEX]);
});
