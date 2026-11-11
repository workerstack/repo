import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { emitMcpPolicy } from "./emit-mcp-policy.ts";
import { DENY_ALL, plant, plantDirs, plantPolicy, readJson, readToml } from "./fixtures/mcp-policy-kit.ts";

const tmp = plantDirs();

afterEach(() => vi.restoreAllMocks());

/** A workspace holding `policy`, and the planted home to pass so no real dotfile is consulted. */
function setup(policy: unknown = DENY_ALL) {
  const ws = tmp("mcp-emit-ws-");
  plantPolicy(ws, policy);
  return { ws, home: tmp("mcp-emit-home-") };
}

it("emitMcpPolicy results: returns the validation error without writing", () => {
  const { ws, home } = setup({ ...DENY_ALL, default: "allow" });
  expect(emitMcpPolicy({ workspaceRoot: ws, home })).toEqual({
    ok: false,
    check: false,
    error: 'default must be "deny"',
  });
  expect(fs.existsSync(path.join(ws, ".grok"))).toBe(false);
});

it("emitMcpPolicy results: returns the validation error in check mode too", () => {
  const { ws, home } = setup({ ...DENY_ALL, allow: "x" });
  expect(emitMcpPolicy({ workspaceRoot: ws, home, check: true })).toEqual({
    ok: false,
    check: true,
    error: "allow must be an array",
  });
});

it("emitMcpPolicy results: uses the process cwd and HOME when neither is passed", () => {
  const { ws, home } = setup();
  vi.spyOn(process, "cwd").mockReturnValue(ws);
  vi.stubEnv("HOME", home);
  expect(emitMcpPolicy()).toEqual({ ok: true, check: false });
  expect(readJson(ws, ".agents/mcp_config.json")).toEqual({ mcpServers: {} });
});

it("emitMcpPolicy .mcp.json: never writes it, and a missing one means no servers", () => {
  const { ws, home } = setup({ ...DENY_ALL, allow: ["a"] });
  expect(emitMcpPolicy({ workspaceRoot: ws, home }).ok).toBe(true);
  expect(fs.existsSync(path.join(ws, ".mcp.json"))).toBe(false);
  expect(readJson(ws, ".agents/mcp_config.json")).toEqual({ mcpServers: {} });
});

it("emitMcpPolicy .mcp.json: reads the consumer's own, not the workspace's, and leaves it as it was", () => {
  const { ws, home } = setup({ ...DENY_ALL, allow: ["a"] });
  const consumer = tmp("mcp-emit-own-");
  const text = JSON.stringify({ mcpServers: { a: { command: "mine" }, b: { command: "off" } } });
  plant(consumer, ".mcp.json", text);
  plant(ws, ".mcp.json", JSON.stringify({ mcpServers: { a: { command: "stage" } } }));
  expect(emitMcpPolicy({ workspaceRoot: ws, home, consumerRoot: consumer }).ok).toBe(true);
  expect(readJson(ws, ".agents/mcp_config.json")).toEqual({ mcpServers: { a: { command: "mine" } } });
  expect(fs.readFileSync(path.join(consumer, ".mcp.json"), "utf8")).toBe(text);
});

it.each([
  ["bad JSON", '{\n  "mcpServers": {\n    "a": }\n}\n', ".mcp.json: not valid JSON at line 3; fix it, nothing written"],
  [
    "mcpServers not an object",
    '{ "mcpServers": [] }',
    ".mcp.json: mcpServers is not an object; fix it, nothing written",
  ],
])("emitMcpPolicy .mcp.json: fails named on %s and writes nothing, in check mode too", (_name, text, error) => {
  const { ws, home } = setup();
  plant(ws, ".mcp.json", text);
  expect(emitMcpPolicy({ workspaceRoot: ws, home })).toEqual({ ok: false, check: false, error });
  expect(emitMcpPolicy({ workspaceRoot: ws, home, check: true })).toEqual({ ok: false, check: true, error });
  expect(fs.readdirSync(ws).sort()).toEqual([".mcp.json", "agents"]);
});

it("emitMcpPolicy results: throws when a host file cannot be read as a file", () => {
  const { ws, home } = setup();
  fs.mkdirSync(path.join(ws, ".grok/config.toml"), { recursive: true });
  expect(() => emitMcpPolicy({ workspaceRoot: ws, home })).toThrow(/EISDIR/);
});

it("emitMcpPolicy results: throws on a host file that does not parse", () => {
  const { ws, home } = setup();
  plant(ws, ".claude/settings.json", "{");
  expect(() => emitMcpPolicy({ workspaceRoot: ws, home })).toThrow();
});

it("emitMcpPolicy results: rejects a consumer policy that is not an object", () => {
  const { ws, home } = setup();
  const consumer = tmp("mcp-emit-own-");
  plant(consumer, ".repo/mcp-policy.jsonc", "[]");
  expect(() => emitMcpPolicy({ workspaceRoot: ws, home, consumerRoot: consumer })).toThrow("invalid policy");
});

it("emitMcpPolicy host files from sparse disks: treats blank files as empty and non-object json as empty", () => {
  const { ws, home } = setup();
  plant(ws, ".grok/config.toml", "  \n");
  plant(ws, ".codex/config.toml", "\n");
  plant(ws, ".claude/settings.json", " ");
  plant(ws, ".agents/mcp_config.json", "3");
  expect(emitMcpPolicy({ workspaceRoot: ws, home }).ok).toBe(true);
  expect(readJson(ws, ".claude/settings.json")).toEqual({
    enableAllProjectMcpServers: false,
    enabledMcpjsonServers: [],
    permissions: { deny: ["mcp__*"] },
  });
  expect(readJson(ws, ".agents/mcp_config.json")).toEqual({ mcpServers: {} });
  expect(readToml(ws, ".codex/config.toml")).toEqual({ agents: { max_depth: 1 } });
});

it("emitMcpPolicy host files from sparse disks: writes the grok file as plain TOML, which sync stamps, and denies MCPTool", () => {
  const { ws, home } = setup();
  emitMcpPolicy({ workspaceRoot: ws, home });
  const text = fs.readFileSync(path.join(ws, ".grok/config.toml"), "utf8");
  expect(text.startsWith("#")).toBe(false);
  expect(readToml(ws, ".grok/config.toml")).toEqual({
    permission: { deny: ["MCPTool"] },
    plugins: { enabled: [] },
  });
});

const withoutDeny = { ...DENY_ALL, plugins: {} };

it("emitMcpPolicy grok plugins: keeps other plugin keys and drops deny_default when plugins are not denied", () => {
  const { ws, home } = setup(withoutDeny);
  plant(ws, ".grok/config.toml", "[plugins]\nkeep = 1\ndeny_default = true\n");
  emitMcpPolicy({ workspaceRoot: ws, home });
  expect(readToml(ws, ".grok/config.toml").plugins).toEqual({ keep: 1 });
});

it("emitMcpPolicy grok plugins: removes an emptied plugins table when plugins are not denied", () => {
  const { ws, home } = setup(withoutDeny);
  plant(ws, ".grok/config.toml", "[plugins]\ndeny_default = true\n");
  emitMcpPolicy({ workspaceRoot: ws, home });
  expect(readToml(ws, ".grok/config.toml")).toEqual({ permission: { deny: ["MCPTool"] } });
});

it("emitMcpPolicy grok plugins: treats a policy without a plugins table as not denying plugins", () => {
  const { ws, home } = setup({ default: "deny", allow: [] });
  emitMcpPolicy({ workspaceRoot: ws, home });
  expect(readToml(ws, ".grok/config.toml")).toEqual({ permission: { deny: ["MCPTool"] } });
});

const allowB = { ...DENY_ALL, allow: ["b"] };
/** The `.mcp.json` servers the grok rows read. */
const SERVERS = JSON.stringify({ mcpServers: { b: { url: "mcp-json" }, s: "stdio" } });

it("emitMcpPolicy grok servers: disables leftover servers, drops mcp.servers, and lets the .mcp.json spec win for allowed names", () => {
  const { ws, home } = setup(allowB);
  plant(ws, ".mcp.json", SERVERS);
  plant(
    ws,
    ".grok/config.toml",
    [
      "[mcp]",
      "keep = 1",
      "[mcp.servers.nested]",
      "command = 'n'",
      "[mcp.servers.b]",
      "url = 'nested-b'",
      "[mcp_servers.native]",
      "command = 'x'",
      "[mcp_servers.b]",
      "url = 'native-b'",
      "",
    ].join("\n"),
  );
  emitMcpPolicy({ workspaceRoot: ws, home });
  const grok = readToml(ws, ".grok/config.toml");
  expect(grok.mcp).toEqual({ keep: 1 });
  expect(grok.mcp_servers).toEqual({
    nested: { command: "n", enabled: false },
    b: { url: "mcp-json" },
    native: { command: "x", enabled: false },
  });
});

it("emitMcpPolicy grok servers: removes mcp when only its servers table was there, and tolerates a non-table server entry", () => {
  const { ws, home } = setup();
  plant(ws, ".grok/config.toml", "[mcp.servers.a]\ncommand = 'a'\n[mcp_servers]\nweird = 'text'\n");
  emitMcpPolicy({ workspaceRoot: ws, home });
  const grok = readToml(ws, ".grok/config.toml");
  expect(grok.mcp).toBeUndefined();
  expect(grok.mcp_servers).toEqual({ a: { command: "a", enabled: false }, weird: { enabled: false } });
});

it("emitMcpPolicy grok servers: copies a non-table .mcp.json spec as is, and writes allowed specs to the other host files", () => {
  const { ws, home } = setup({ ...DENY_ALL, allow: ["s"] });
  plant(ws, ".mcp.json", SERVERS);
  emitMcpPolicy({ workspaceRoot: ws, home });
  expect(readToml(ws, ".grok/config.toml").mcp_servers).toEqual({ s: "stdio" });
  expect(readJson(ws, ".agents/mcp_config.json")).toEqual({ mcpServers: { s: "stdio" } });
  expect(readToml(ws, ".codex/config.toml").mcp_servers).toEqual({ s: "stdio" });
  expect(readJson(ws, ".claude/settings.json").enabledMcpjsonServers).toEqual(["s"]);
});

it("emitMcpPolicy grok servers: emits no servers for an allowed name .mcp.json does not define", () => {
  const { ws, home } = setup({ default: "deny", allow: ["ghost"] });
  plant(ws, ".mcp.json", SERVERS);
  emitMcpPolicy({ workspaceRoot: ws, home });
  expect(readJson(ws, ".agents/mcp_config.json")).toEqual({ mcpServers: {} });
});

it("emitMcpPolicy grok servers: clears a stale codex mcp_servers when nothing is allowed", () => {
  const { ws, home } = setup();
  plant(ws, ".codex/config.toml", "[mcp_servers.old]\ncommand = 'o'\n");
  emitMcpPolicy({ workspaceRoot: ws, home });
  expect(readToml(ws, ".codex/config.toml")).toEqual({ agents: { max_depth: 1 } });
});
