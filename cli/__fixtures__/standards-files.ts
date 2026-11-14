import { AGENT_DEFAULTS } from "../agent-defaults.constants.ts";
import { standards } from "../sync/standards.ts";
import { BASE_CONFIG } from "./base-config.ts";

/** The configs sync writes for the standards pack alone, path to content. */
export function standardsFiles(): Record<string, string> {
  const ctx = {
    config: { agents: { ...AGENT_DEFAULTS, hosts: [], skills: [] }, packs: ["standards" as const], ...BASE_CONFIG },
    read: () => null,
    root: "",
    workspace: { manifest: {}, packages: [], root: "" },
  };

  return Object.fromEntries(
    standards(ctx, []).outputs.map((output) => [output.path, output.kind === "file" ? output.content : ""]),
  );
}
