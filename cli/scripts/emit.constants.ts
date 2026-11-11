/** The error code a read of a missing file throws. */
export const NOT_FOUND = "ENOENT";
/** The indent the emitters write JSON with. */
export const JSON_INDENT = 2;

/** The policy's one allowed default. */
export const POLICY_DEFAULT = "deny";
/** Grok's permission rule name for every MCP tool. */
export const MCP_TOOL = "MCPTool";
/** Claude's deny rule for every MCP tool. */
export const MCP_DENY = "mcp__*";
/** The agents a policy's `agents` table may name; each row must set `inherit: false`. */
export const AGENT_IDS: readonly string[] = [
  "orchestrator",
  "scout",
  "researcher",
  "implementer-fast",
  "implementer-deep",
];

/** The stock policy, a consumer's own policy over it, and the user's own servers. */
export const POLICY_REL = "agents/mcp-policy.jsonc";
export const CONSUMER_POLICY_REL = ".repo/mcp-policy.jsonc";
export const MCP_JSON_REL = ".mcp.json";
/** The host files the MCP policy emit writes. */
export const GROK_REL = ".grok/config.toml";
export const CLAUDE_SETTINGS_REL = ".claude/settings.json";
export const CODEX_REL = ".codex/config.toml";
export const AGENTS_MCP_REL = ".agents/mcp_config.json";
