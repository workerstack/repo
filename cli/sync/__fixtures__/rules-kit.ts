// Rule docs and the text `renderRules` plans for them, shared by the rules suites.
import { AGENT_DEFAULTS } from "../../agent-defaults.constants.ts";
import type { Host } from "../../config.ts";
import type { Effort } from "../../scripts/strategy.types.ts";
import type { Doc, Sources } from "../agents/sources.types.ts";
import { renderRules } from "../agents/rules.ts";

export function rule(file: string, data: Record<string, unknown>, body: string): Doc {
  return ruleIn(".repo", { body, data, file });
}

/** A stock rule, under `agents/`. */
export function stockRule(file: string, data: Record<string, unknown>, body: string): Doc {
  return ruleIn("agents", { body, data, file });
}

function ruleIn(dir: string, { file, data, body }: { file: string; data: Record<string, unknown>; body: string }): Doc {
  return {
    body,
    data: { description: "d", ...data },
    file,
    origin: dir === "agents" ? "stock" : "repo",
    rel: `${dir}/rules/${file}`,
    scope: "",
  };
}

export function sourcesOf(rules: Doc[]): Sources {
  return { hooks: { rel: "agents/hooks.jsonc", value: {} }, rules, subagents: [] };
}

/** The text of every file `renderRules` plans for the root scope, or for `scope`, on a config's resolved effort. */
export function renderText(
  sources: Sources,
  hosts: readonly Host[],
  scope = "",
  effort: Effort = AGENT_DEFAULTS.defaultEffort,
): Map<string, string> {
  return new Map([...renderRules(sources.rules, { effort, hosts, scope })].map(([rel, file]) => [rel, file.text]));
}

export const BASE: Doc = stockRule("overview.md", {}, "Base body.");
export const SCOPED: Doc = rule("testing.md", { paths: ["src/**", "lib/**"] }, "Test body.");
