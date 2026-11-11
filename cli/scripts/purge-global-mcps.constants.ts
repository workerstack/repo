/** The grok plugins a purge disables, and the MCP servers it adds to grok's disabled list. */
export const PLUGIN_IDS: readonly string[] = ["cloudflare", "stripe"];
export const DISABLE_MCP: readonly string[] = ["cloudflare-docs", "MCP_DOCKER", "stripe"];
/** The grok key that lists disabled MCP servers. */
export const MCP_KEY = "disabled_mcp_servers";
/** The cursor MCP server a purge drops. */
export const CURSOR_SERVER = "MCP_DOCKER";
/** The claude plugin a purge uninstalls, under any marketplace (`stripe@…`). */
export const STRIPE_PLUGIN = "stripe";
/** The error code of a dest that does not exist. */
export const NOT_FOUND = "ENOENT";
/** The flag that writes instead of reporting. */
export const APPLY_FLAG = "--apply";
/** The action each report line starts with. */
export const APPLY_ACTION = "apply";
export const DRY_RUN_ACTION = "dry-run";
/** The detail of a dest left as it is. */
export const MISSING = "noop (missing)";
export const ALREADY_CLEAN = "noop (already clean)";
/** The indent JSON dests are written with. */
export const JSON_INDENT = 2;
