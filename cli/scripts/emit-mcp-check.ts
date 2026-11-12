import { isRecord, type JsonObject } from "../json.ts";
import { mcpToolAllow, type Policy } from "./emit-mcp-hosts.ts";
import { deepEqual, requiredDeepMatch } from "./emit-mcp-validate.ts";
/** Whether each host's config on disk already holds what the MCP policy wants. */
import { MCP_DENY, MCP_TOOL } from "./emit.constants.ts";

/** Whether a table an older emit wrote, or one only the home config keeps, is still on disk. */
function grokLegacyLeft(disk: JsonObject, { keepHomeTables }: { keepHomeTables: boolean }): boolean {
  return (
    (!keepHomeTables && Object.hasOwn(disk, "features")) ||
    Array.isArray(disk.permissions) ||
    (isRecord(disk.plugins) && Object.hasOwn(disk.plugins, "deny_default")) ||
    (isRecord(disk.mcp) && Object.hasOwn(disk.mcp, "servers"))
  );
}

function grokPermissionOk(disk: JsonObject, allowNames: string[]): boolean {
  const permission = isRecord(disk.permission) ? disk.permission : {};
  const deny: unknown[] = Array.isArray(permission.deny) ? permission.deny : [];
  const allow: unknown[] = Array.isArray(permission.allow) ? permission.allow : [];

  return deny.includes(MCP_TOOL) && allowNames.every((name) => allow.includes(mcpToolAllow(name)));
}

export function grokCheckOk(
  disk: JsonObject,
  { desired, policy, keepHomeTables }: { desired: JsonObject; policy: Policy; keepHomeTables: boolean },
): boolean {
  if (grokLegacyLeft(disk, { keepHomeTables }) || !grokPermissionOk(disk, policy.allow)) return false;

  if (policy.denyPlugins && !requiredDeepMatch(disk, { plugins: { enabled: [] } })) return false;

  return desired.mcp_servers === undefined || requiredDeepMatch(disk, { mcp_servers: desired.mcp_servers });
}

export function claudeCheckOk(disk: JsonObject, desired: JsonObject): boolean {
  if (disk.enableAllProjectMcpServers !== false) return false;

  if (!deepEqual(disk.enabledMcpjsonServers, desired.enabledMcpjsonServers)) return false;

  const deny: unknown[] =
    isRecord(disk.permissions) && Array.isArray(disk.permissions.deny) ? disk.permissions.deny : [];

  return deny.includes(MCP_DENY);
}

export function codexCheckOk(disk: JsonObject, desired: JsonObject & { agents: JsonObject }, allow: string[]): boolean {
  if (!requiredDeepMatch(disk, { agents: { max_depth: desired.agents.max_depth } })) return false;

  return allow.length > 0 ? deepEqual(disk.mcp_servers, desired.mcp_servers) : !Object.hasOwn(disk, "mcp_servers");
}
