/** What the MCP policy wants in each host's config, from what is on disk. */
import path from "node:path";

import { isRecord, type JsonObject } from "../json.ts";
import { GROK_REL, MCP_DENY, MCP_TOOL } from "./emit.constants.ts";
import { isSettingsTable, type SettingsTable, type SettingsValue } from "./settings-table.ts";

/** The parts of a validated policy the emitters read; `servers` are those of the user's `.mcp.json`. */
export type Policy = {
  allow: string[];
  servers: JsonObject;
  denyPlugins: boolean;
};

/** The codex config the policy wants: its `[agents]` table always sets `max_depth`. */
export type CodexConfig = SettingsTable & { agents: SettingsTable & { max_depth: SettingsValue } };

export function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

/** Grok's allow rule for every tool of server `name`. */
export function mcpToolAllow(name: string): string {
  return `${MCP_TOOL}(${name}__*)`;
}

function isMcpToolRule(s: string): boolean {
  return s === MCP_TOOL || s.startsWith(`${MCP_TOOL}(`);
}

function pickServers(servers: JsonObject, allow: string[]): JsonObject {
  const out: JsonObject = {};

  for (const name of allow) {
    const spec = servers[name];

    if (Object.hasOwn(servers, name) && spec !== undefined) out[name] = structuredClone(spec);
  }

  return out;
}

export function isHomeGrokConfig(workspaceRoot: string | undefined, home: string | undefined): boolean {
  if (workspaceRoot === undefined || workspaceRoot === "" || home === undefined || home === "") return false;

  return path.resolve(workspaceRoot, GROK_REL) === path.resolve(home, GROK_REL);
}

/** Drops the legacy `deny_default`; denied plugins get an empty `enabled`, and an empty table goes. */
function setPlugins(obj: SettingsTable, { denyPlugins }: Pick<Policy, "denyPlugins">): void {
  const plugins: SettingsTable = isSettingsTable(obj.plugins) ? { ...obj.plugins } : {};
  delete plugins.deny_default;

  if (denyPlugins) {
    plugins.enabled = [];
    obj.plugins = plugins;
  } else if (Object.keys(plugins).length > 0) {
    obj.plugins = plugins;
  } else {
    delete obj.plugins;
  }
}

/** Grok's permission table: every MCP tool denied, the allowed servers' tools allowed first, other rules kept. */
function grokPermission(obj: SettingsTable, allow: string[]): SettingsTable {
  const perm: SettingsTable = isSettingsTable(obj.permission) ? { ...obj.permission } : {};
  perm.deny = [...stringList(perm.deny).filter((s) => s !== MCP_TOOL), MCP_TOOL];
  const nextAllow = [...allow.map(mcpToolAllow), ...stringList(perm.allow).filter((s) => !isMcpToolRule(s))];

  if (nextAllow.length > 0) perm.allow = nextAllow;
  else delete perm.allow;

  return perm;
}

/** Drops the legacy nested `mcp.servers`, and the `mcp` table when nothing else is in it. */
function dropNestedServers(obj: SettingsTable): void {
  if (!isSettingsTable(obj.mcp)) return;
  const mcp = { ...obj.mcp };
  delete mcp.servers;

  if (Object.keys(mcp).length > 0) obj.mcp = mcp;
  else delete obj.mcp;
}

function leftoverOf(native: SettingsValue | undefined, nested: SettingsValue | undefined): SettingsTable {
  if (isSettingsTable(native)) return native;

  return isSettingsTable(nested) ? nested : {};
}

/** Every server on disk, disabled unless allowed, then the allowed servers of the policy over them. */
function grokServers(disk: SettingsTable, policy: Policy): SettingsTable {
  const allowSet = new Set(policy.allow);
  const native = isSettingsTable(disk.mcp_servers) ? disk.mcp_servers : {};
  const nested = isSettingsTable(disk.mcp) && isSettingsTable(disk.mcp.servers) ? disk.mcp.servers : {};
  const servers: SettingsTable = {};

  for (const name of new Set([...Object.keys(native), ...Object.keys(nested)])) {
    const prev = leftoverOf(native[name], nested[name]);
    servers[name] = allowSet.has(name) ? { ...prev } : { ...prev, enabled: false };
  }

  for (const [name, spec] of Object.entries(pickServers(policy.servers, policy.allow)))
    servers[name] = isRecord(spec) ? { ...spec } : spec;

  return servers;
}

export function desiredGrok(
  disk: SettingsTable,
  policy: Policy,
  { keepHomeTables }: { keepHomeTables: boolean },
): SettingsTable {
  const obj = { ...disk };

  if (!keepHomeTables) delete obj.features;
  delete obj.permissions;
  setPlugins(obj, policy);
  obj.permission = grokPermission(obj, policy.allow);
  dropNestedServers(obj);
  const servers = grokServers(disk, policy);

  if (Object.keys(servers).length === 0) delete obj.mcp_servers;
  else obj.mcp_servers = servers;

  return obj;
}

export function desiredClaudeSettings(disk: JsonObject, policy: Policy): JsonObject {
  const obj = { ...disk };
  obj.enableAllProjectMcpServers = false;
  obj.enabledMcpjsonServers = [...policy.allow];
  const permissions = isRecord(obj.permissions) ? { ...obj.permissions } : {};
  const deny = Array.isArray(permissions.deny) ? [...permissions.deny] : [];

  if (!deny.includes(MCP_DENY)) deny.push(MCP_DENY);
  permissions.deny = deny;
  obj.permissions = permissions;

  return obj;
}

export function desiredCodex(disk: SettingsTable, policy: Policy): CodexConfig {
  const obj: SettingsTable = { ...disk };
  const prev: SettingsTable = isSettingsTable(obj.agents) ? obj.agents : {};
  const agents = { ...prev, max_depth: prev.max_depth ?? 1 };
  obj.agents = agents;

  if (policy.allow.length > 0) obj.mcp_servers = pickServers(policy.servers, policy.allow);
  else delete obj.mcp_servers;

  return { ...obj, agents };
}

export function desiredAgentsMcp(policy: Policy): JsonObject {
  return { mcpServers: pickServers(policy.servers, policy.allow) };
}
