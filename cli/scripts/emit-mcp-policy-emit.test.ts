import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { DENY_ALL, plant, plantDirs, plantPolicy, readJson, readToml } from "./__fixtures__/mcp-policy-kit.ts";
import { emitMcpPolicy } from "./emit-mcp-policy.ts";

const tmp = plantDirs();
const NOT_OBJECT = ".mcp.json: mcpServers is not an object; fix it, nothing written";

/** The TOML file as plain objects: the parser's null-prototype tables would fail a strict compare. */
function plainToml(root: string, rel: string): Record<string, unknown> {
  return structuredClone(readToml(root, rel));
}

afterEach(() => vi.restoreAllMocks());

/** A workspace holding `policy`, and the planted home to pass so no real dotfile is consulted. */
function setup(policy: unknown = DENY_ALL) {
  const ws = tmp("mcp-emit-ws-");
  plantPolicy(ws, policy);
  return { home: tmp("mcp-emit-home-"), ws };
}

it("emitMcpPolicy results: returns the validation error without writing", () => {
  const { ws, home } = setup({ ...DENY_ALL, default: "allow" });
  expect(emitMcpPolicy({ home, workspaceRoot: ws })).toStrictEqual({
    check: false,
    error: 'default must be "deny"',
    ok: false,
  });
  expect(fs.existsSync(path.join(ws, ".grok"))).toBe(false);
});

it("emitMcpPolicy results: returns the validation error in check mode too", () => {
  const { ws, home } = setup({ ...DENY_ALL, allow: "x" });
  expect(emitMcpPolicy({ check: true, home, workspaceRoot: ws })).toStrictEqual({
    check: true,
    error: "allow must be an array",
    ok: false,
  });
});

it("emitMcpPolicy results: uses the process cwd and HOME when neither is passed", () => {
  const { ws, home } = setup();
  vi.spyOn(process, "cwd").mockReturnValue(ws);
  vi.stubEnv("HOME", home);
  expect(emitMcpPolicy()).toStrictEqual({ check: false, ok: true });
  expect(readJson(ws, ".agents/mcp_config.json")).toStrictEqual({ mcpServers: {} });
});

it("emitMcpPolicy .mcp.json: never writes it, and a missing one means no servers", () => {
  const { ws, home } = setup({ ...DENY_ALL, allow: ["a"] });
  expect(emitMcpPolicy({ home, workspaceRoot: ws }).ok).toBe(true);
  expect(fs.existsSync(path.join(ws, ".mcp.json"))).toBe(false);
  expect(readJson(ws, ".agents/mcp_config.json")).toStrictEqual({ mcpServers: {} });
});

it("emitMcpPolicy .mcp.json: reads the consumer's own, not the workspace's, and leaves it as it was", () => {
  const { ws, home } = setup({ ...DENY_ALL, allow: ["a"] });
  const consumer = tmp("mcp-emit-own-");
  const text = JSON.stringify({ mcpServers: { a: { command: "mine" }, b: { command: "off" } } });
  plant(consumer, ".mcp.json", text);
  plant(ws, ".mcp.json", JSON.stringify({ mcpServers: { a: { command: "stage" } } }));
  expect(emitMcpPolicy({ consumerRoot: consumer, home, workspaceRoot: ws }).ok).toBe(true);
  expect(readJson(ws, ".agents/mcp_config.json")).toStrictEqual({ mcpServers: { a: { command: "mine" } } });
  expect(fs.readFileSync(path.join(consumer, ".mcp.json"), "utf8")).toBe(text);
});

it.each([
  ["bad JSON", '{\n  "mcpServers": {\n    "a": }\n}\n', ".mcp.json: not valid JSON at line 3; fix it, nothing written"],
  ["mcpServers not an object", '{ "mcpServers": [] }', NOT_OBJECT],
])("emitMcpPolicy .mcp.json: fails named on %s and writes nothing, in check mode too", (_name, text, error) => {
  const { ws, home } = setup();
  plant(ws, ".mcp.json", text);
  expect(emitMcpPolicy({ home, workspaceRoot: ws })).toStrictEqual({ check: false, error, ok: false });
  expect(emitMcpPolicy({ check: true, home, workspaceRoot: ws })).toStrictEqual({ check: true, error, ok: false });
  expect(fs.readdirSync(ws).toSorted()).toStrictEqual([".mcp.json", "agents"]);
});

it("emitMcpPolicy results: throws when a host file cannot be read as a file", () => {
  const { ws, home } = setup();
  fs.mkdirSync(path.join(ws, ".grok/config.toml"), { recursive: true });
  expect(() => emitMcpPolicy({ home, workspaceRoot: ws })).toThrow(/EISDIR/);
});

it("emitMcpPolicy results: throws on a host file that does not parse", () => {
  const { ws, home } = setup();
  plant(ws, ".claude/settings.json", "{");
  expect(() => emitMcpPolicy({ home, workspaceRoot: ws })).toThrow(SyntaxError);
});

it("emitMcpPolicy results: rejects a consumer policy that is not an object", () => {
  const { ws, home } = setup();
  const consumer = tmp("mcp-emit-own-");
  plant(consumer, ".repo/mcp-policy.jsonc", "[]");
  expect(() => emitMcpPolicy({ consumerRoot: consumer, home, workspaceRoot: ws })).toThrow("invalid policy");
});

it("emitMcpPolicy host files from sparse disks: treats blank files as empty and non-object json as empty", () => {
  const { ws, home } = setup();
  plant(ws, ".grok/config.toml", "  \n");
  plant(ws, ".codex/config.toml", "\n");
  plant(ws, ".claude/settings.json", " ");
  plant(ws, ".agents/mcp_config.json", "3");
  expect(emitMcpPolicy({ home, workspaceRoot: ws }).ok).toBe(true);
  expect(readJson(ws, ".claude/settings.json")).toStrictEqual({
    enableAllProjectMcpServers: false,
    enabledMcpjsonServers: [],
    permissions: { deny: ["mcp__*"] },
  });
  expect(readJson(ws, ".agents/mcp_config.json")).toStrictEqual({ mcpServers: {} });
  expect(plainToml(ws, ".codex/config.toml")).toStrictEqual({ agents: { max_depth: 1 } });
});

it(
  "emitMcpPolicy host files from sparse disks: writes the grok " +
    "file as plain TOML, which sync stamps, and denies MCPTool",
  () => {
    const { ws, home } = setup();
    emitMcpPolicy({ home, workspaceRoot: ws });
    expect(fs.readFileSync(path.join(ws, ".grok/config.toml"), "utf8").startsWith("#")).toBe(false);
    expect(plainToml(ws, ".grok/config.toml")).toStrictEqual({
      permission: { deny: ["MCPTool"] },
      plugins: { enabled: [] },
    });
  },
);

const withoutDeny = { ...DENY_ALL, plugins: {} };

it("emitMcpPolicy grok plugins: keeps other plugin keys and drops deny_default when plugins are not denied", () => {
  const { ws, home } = setup(withoutDeny);
  plant(ws, ".grok/config.toml", "[plugins]\nkeep = 1\ndeny_default = true\n");
  emitMcpPolicy({ home, workspaceRoot: ws });
  expect(plainToml(ws, ".grok/config.toml").plugins).toStrictEqual({ keep: 1 });
});

it("emitMcpPolicy grok plugins: removes an emptied plugins table when plugins are not denied", () => {
  const { ws, home } = setup(withoutDeny);
  plant(ws, ".grok/config.toml", "[plugins]\ndeny_default = true\n");
  emitMcpPolicy({ home, workspaceRoot: ws });
  expect(plainToml(ws, ".grok/config.toml")).toStrictEqual({ permission: { deny: ["MCPTool"] } });
});

it("emitMcpPolicy grok plugins: treats a policy without a plugins table as not denying plugins", () => {
  const { ws, home } = setup({ allow: [], default: "deny" });
  emitMcpPolicy({ home, workspaceRoot: ws });
  expect(plainToml(ws, ".grok/config.toml")).toStrictEqual({ permission: { deny: ["MCPTool"] } });
});

const allowB = { ...DENY_ALL, allow: ["b"] };
/** The `.mcp.json` servers the grok rows read. */
const SERVERS = JSON.stringify({ mcpServers: { b: { url: "mcp-json" }, s: "stdio" } });

it(
  "emitMcpPolicy grok servers: disables leftover servers, drops " +
    "mcp.servers, and lets the .mcp.json spec win for allowed names",
  () => {
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
    emitMcpPolicy({ home, workspaceRoot: ws });
    const grok = plainToml(ws, ".grok/config.toml");
    expect(grok.mcp).toStrictEqual({ keep: 1 });
    expect(grok.mcp_servers).toStrictEqual({
      b: { url: "mcp-json" },
      native: { command: "x", enabled: false },
      nested: { command: "n", enabled: false },
    });
  },
);

it(
  "emitMcpPolicy grok servers: removes mcp when only its servers " +
    "table was there, and tolerates a non-table server entry",
  () => {
    const { ws, home } = setup();
    plant(ws, ".grok/config.toml", "[mcp.servers.a]\ncommand = 'a'\n[mcp_servers]\nweird = 'text'\n");
    emitMcpPolicy({ home, workspaceRoot: ws });
    const grok = plainToml(ws, ".grok/config.toml");
    expect(grok.mcp).toBeUndefined();
    expect(grok.mcp_servers).toStrictEqual({ a: { command: "a", enabled: false }, weird: { enabled: false } });
  },
);

it(
  "emitMcpPolicy grok servers: copies a non-table .mcp.json " +
    "spec as is, and writes allowed specs to the other host files",
  () => {
    const { ws, home } = setup({ ...DENY_ALL, allow: ["s"] });
    plant(ws, ".mcp.json", SERVERS);
    emitMcpPolicy({ home, workspaceRoot: ws });
    expect(plainToml(ws, ".grok/config.toml").mcp_servers).toStrictEqual({ s: "stdio" });
    expect(readJson(ws, ".agents/mcp_config.json")).toStrictEqual({ mcpServers: { s: "stdio" } });
    expect(plainToml(ws, ".codex/config.toml").mcp_servers).toStrictEqual({ s: "stdio" });
    expect(readJson(ws, ".claude/settings.json").enabledMcpjsonServers).toStrictEqual(["s"]);
  },
);

it("emitMcpPolicy grok servers: emits no servers for an allowed name .mcp.json does not define", () => {
  const { ws, home } = setup({ allow: ["ghost"], default: "deny" });
  plant(ws, ".mcp.json", SERVERS);
  emitMcpPolicy({ home, workspaceRoot: ws });
  expect(readJson(ws, ".agents/mcp_config.json")).toStrictEqual({ mcpServers: {} });
});

it("emitMcpPolicy grok servers: clears a stale codex mcp_servers when nothing is allowed", () => {
  const { ws, home } = setup();
  plant(ws, ".codex/config.toml", "[mcp_servers.old]\ncommand = 'o'\n");
  emitMcpPolicy({ home, workspaceRoot: ws });
  expect(plainToml(ws, ".codex/config.toml")).toStrictEqual({ agents: { max_depth: 1 } });
});
