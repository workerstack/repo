const NO_SERVERS: string[] = [];

/** A valid MCP policy: deny by default, no server allowed, plugins denied, two agents that do not inherit. */
export const BASE_POLICY = {
  agents: { orchestrator: { inherit: false }, repo: { inherit: false } },
  allow: NO_SERVERS,
  default: "deny",
  plugins: { denyDefault: true },
};
