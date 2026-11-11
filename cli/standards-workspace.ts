import type { ResolvedConfig } from "./config-resolved.types.ts";
import { standardsRoot } from "./standards-root.ts";
import { readWorkspace, type Workspace } from "./sync/workspace.ts";

/**
 * The workspace and config of the repo at `cwd` when it runs the standards pack; null without a config, the pack or a
 * readable workspace (sync --check reports an unreadable manifest).
 */
export async function standardsWorkspace(
  cwd: string,
): Promise<{ workspace: Workspace; config: ResolvedConfig } | null> {
  const found = await standardsRoot(cwd);
  if (found === null) return null;
  const read = readWorkspace(found.root);
  return read.ok ? { config: found.config, workspace: read.workspace } : null;
}
