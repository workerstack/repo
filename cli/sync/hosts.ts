import type { Host } from "../config.ts";

/** What one host owns: the root-relative path prefixes its tree is written under. */
export type HostTree = { owns: readonly string[] };

/** The one table of which host owns which dirs; trees, the git files and prune all read it. */
export const HOST_TREES: Record<Host, HostTree> = {
  claude: { owns: [".claude/"] },
  codex: { owns: [".codex/", ".agents/skills/"] },
  antigravity: { owns: [".agents/"] },
  grok: { owns: [".grok/"] },
  cursor: { owns: [".cursor/"] },
};

/** The agent instructions file; every host reads it. */
export const AGENTS_FILE = "AGENTS.md";
/** The file a package keeps for claude, which holds only the pointer line. */
export const CLAUDE_FILE = "CLAUDE.md";
/** The MCP server list Claude reads. */
export const MCP_FILE = ".mcp.json";

/** Whether a generated root-relative path (a package's `AGENTS.md` and `CLAUDE.md` included) belongs to one of `hosts`; any other path is not a host output. */
export function isHostOutput(hosts: readonly Host[], rel: string): boolean {
  if (rel === AGENTS_FILE || rel.endsWith(`/${AGENTS_FILE}`)) return hosts.length > 0;
  if (rel.endsWith(`/${CLAUDE_FILE}`)) return hosts.includes("claude");
  if (rel === MCP_FILE) return hosts.includes("claude");
  return hosts.some((host) => HOST_TREES[host].owns.some((prefix) => rel.startsWith(prefix)));
}
