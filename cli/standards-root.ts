import type { ResolvedConfig } from "./config-resolved.types.ts";
import { findRoot, loadConfig } from "./config.ts";

/** The root and config of the repo at `cwd` when it runs the standards pack; null without a config or the pack. */
export async function standardsRoot(cwd: string): Promise<{ root: string; config: ResolvedConfig } | null> {
  const root = findRoot(cwd);
  if (root === null) return null;
  const loaded = await loadConfig(root);
  return loaded.ok && loaded.config.packs.includes("standards") ? { config: loaded.config, root } : null;
}
