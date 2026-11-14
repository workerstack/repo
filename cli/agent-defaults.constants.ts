/** The agents defaults a repo gets when its config omits them, or has none a hook can load. */
import type { AgentDefaults } from "./config-resolved.types.ts";

export const AGENT_DEFAULTS: AgentDefaults = { defaultApproval: "ask", defaultEffort: "deep", defaultStrategy: "free" };
