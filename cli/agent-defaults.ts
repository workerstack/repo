/** The agents defaults of a repo root, for the hooks and commands that read them. */
import { AGENT_DEFAULTS } from "./agent-defaults.constants.ts";
import type { AgentDefaults } from "./config-resolved.types.ts";

/**
 * The agents defaults `<root>/repo.config.ts` resolves to; the built-in ones when it is missing or fails to load, so
 * no hook fails over the config. The config module loads here, so a caller that never asks pays nothing for it.
 */
export async function agentDefaults(root: string): Promise<AgentDefaults> {
  const { loadConfig } = await import("./config.ts");
  const loaded = await loadConfig(root);

  if (!loaded.ok) return AGENT_DEFAULTS;
  const { defaultEffort, defaultMode, defaultStrategy } = loaded.config.agents;

  return { defaultEffort, defaultMode, defaultStrategy };
}
