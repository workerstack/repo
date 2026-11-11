import type { Host } from "../config.ts";
import { AGENTS_FILE } from "./agents-file.constants.ts";

/** What one host owns: the root-relative path prefixes its tree is written under. */
export type HostTree = { owns: readonly string[] };

/** The one table of which host owns which dirs; trees, the git files and prune all read it. */
export const HOST_TREES: Record<Host, HostTree> = {
  antigravity: { owns: [".agents/"] },
  claude: { owns: [".claude/"] },
  codex: { owns: [".codex/", ".agents/skills/"] },
  cursor: { owns: [".cursor/"] },
  grok: { owns: [".grok/"] },
};

/** Whether a generated root-relative path (a package's `AGENTS.md` included) belongs to one of `hosts`; any other path, `.mcp.json` too, is not a host output. */
export function isHostOutput(hosts: readonly Host[], rel: string): boolean {
  if (rel === AGENTS_FILE || rel.endsWith(`/${AGENTS_FILE}`)) return hosts.length > 0;
  return hosts.some((host) => HOST_TREES[host].owns.some((prefix) => rel.startsWith(prefix)));
}
