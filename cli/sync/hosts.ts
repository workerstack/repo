import type { Host } from "../config.ts";

/** What one host owns: its rulesync target and the root-relative path prefixes its tree is written under. */
export type HostTree = { target: string; owns: readonly string[] };

/** The one table of which host owns which dirs; trees, the gitignore block and prune all read it. */
export const HOST_TREES: Record<Host, HostTree> = {
  claude: { target: "claudecode", owns: [".claude/"] },
  codex: { target: "codexcli", owns: [".codex/", ".agents/skills/"] },
  antigravity: { target: "antigravity-cli", owns: [".agents/"] },
  grok: { target: "grokcli", owns: [".grok/"] },
  cursor: { target: "cursor", owns: [".cursor/"] },
};

/** The agent instructions file; every host reads it. */
export const AGENTS_FILE = "AGENTS.md";
/** The MCP server list Claude reads. */
export const MCP_FILE = ".mcp.json";

/** Whether a generated root-relative path belongs to one of `hosts`; any other path is not a host output. */
export function isHostOutput(hosts: readonly Host[], rel: string): boolean {
  if (rel === AGENTS_FILE) return hosts.length > 0;
  if (rel === MCP_FILE) return hosts.includes("claude");
  return hosts.some((host) => HOST_TREES[host].owns.some((prefix) => rel.startsWith(prefix)));
}

/** What a consumer's gitignore block lists for `hosts`: the files, then each dir once, a parent dir covering its children. */
export function ignoredPaths(hosts: readonly Host[]): string[] {
  const dirs = new Set(hosts.flatMap((host) => HOST_TREES[host].owns));
  const kept = [...dirs].filter((dir) => ![...dirs].some((other) => other !== dir && dir.startsWith(other)));
  const files = [...(hosts.length > 0 ? [AGENTS_FILE] : []), ...(hosts.includes("claude") ? [MCP_FILE] : [])];
  return [...files, ...kept.sort()];
}
