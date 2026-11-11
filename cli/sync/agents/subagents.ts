/**
 * Subagent files for each enabled host, from one set of subagent sources. A source names its hosts with
 * `targets` (default all) and carries one block per host (`claudecode:`, `codexcli:`, `antigravity-cli:`,
 * `grokcli:`, `cursor:`); top-level keys the hosts do not read (`tier`, `exec`) are ignored.
 */
import { stringify } from "smol-toml";

import type { Host } from "../../config.ts";
import { type YamlMap, type YamlMode, type YamlValue, emitYaml, finalize } from "./frontmatter.ts";
import type { Doc, Sources } from "./sources.ts";

/** The `targets` name and frontmatter block of each host. */
export const TARGET: Record<Host, string> = {
  antigravity: "antigravity-cli",
  claude: "claudecode",
  codex: "codexcli",
  cursor: "cursor",
  grok: "grokcli",
};

/** Keys each host's schema knows, in the order they are written; other keys follow in source order. */
const CLAUDE_KEYS = [
  "name",
  "description",
  "model",
  "tools",
  "disallowedTools",
  "permissionMode",
  "maxTurns",
  "skills",
  "color",
  "memory",
  "effort",
  "isolation",
  "background",
  "initialPrompt",
  "mcpServers",
  "hooks",
];
const ANTIGRAVITY_KEYS = [
  "name",
  "description",
  "tools",
  "mainAgent",
  "subagent",
  "model",
  "commandExecutionPolicy",
  "mcpServers",
  "skills",
  "plugins",
  "hidden",
  "inheritMcp",
];

/** Path to text for every subagent file the enabled `hosts` get; nested sources (`x/y.md`) reach claude only. */
export function renderSubagents(sources: Sources, hosts: readonly Host[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const doc of [...sources.subagents].sort(shallowestFirst)) {
    const name = doc.data["name"];
    if (typeof name !== "string") throw new Error(`${doc.rel}: invalid frontmatter: name must be a string`);
    const nested = doc.file.includes("/");
    for (const host of hosts) {
      if (!targets(doc, TARGET[host]) || (nested && host !== "claude")) continue;
      const [rel, text] = render(host, doc, name);
      out.set(rel, finalize(text));
    }
  }
  return out;
}

function render(host: Host, doc: Doc, name: string): [string, string] {
  const { data, body } = doc;
  const description = data["description"];
  const own = (key: string) => without(block(data[key]), "name", "description");
  switch (host) {
    case "claude":
      return [
        `.claude/agents/${doc.file}`,
        markdown(ordered({ description, name, ...own("claudecode") }, CLAUDE_KEYS), body, "claude"),
      ];
    case "antigravity": {
      const merged = { ...block(data["antigravity-ide"]), ...block(data["antigravity-cli"]) };
      const fm = { description: description ?? `${name} subagent`, name, ...without(merged, "name", "description") };
      return [`.agents/agents/${doc.file}`, markdown(flatten(ordered(fm, ANTIGRAVITY_KEYS)), body, "default")];
    }
    case "grok":
    case "cursor": {
      const dir = host === "grok" ? ".grok" : ".cursor";
      return [
        `${dir}/agents/${doc.file}`,
        markdown(flatten({ description, name, ...block(data[TARGET[host]]) }), body, "default"),
      ];
    }
    case "codex": {
      const rest: Record<string, unknown> = { name, ...(description ? { description } : {}) };
      Object.assign(
        rest,
        without(block(data["codexcli"]), "name", "description", "developer_instructions", "short-description"),
      );
      return [`.codex/agents/${doc.file.replace(/\.md$/, ".toml")}`, codexToml(rest, body)];
    }
  }
}

/**
 * smol-toml for the frontmatter, then `developer_instructions` appended last. A multi-line body without `'''`
 * becomes a `'''` block. Appending after any `[table]` puts the key inside that table, as rulesync did.
 */
function codexToml(rest: Record<string, unknown>, body: string): string {
  const head = `${stringify(rest).trimEnd()}\n`;
  if (body === "") return head;
  if (body.includes("\n") && !body.includes("'''")) return `${head}developer_instructions = '''\n${body}\n'''\n`;
  return `${head}${stringify({ developer_instructions: body })}`;
}

/** Gray-matter layout: fences around the YAML, then the body. */
function markdown(fm: Record<string, unknown>, body: string, mode: YamlMode): string {
  return `---\n${emitYaml(Object.entries(fm) as [string, YamlValue][], mode)}---\n${body}\n`;
}

function targets(doc: Doc, target: string): boolean {
  const list = doc.data["targets"];
  if (list === undefined) return true;
  const names = Array.isArray(list) ? list : [list];
  return names.includes("*") || names.includes(target);
}

function block(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function without(map: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(map).filter(([key]) => !keys.includes(key)));
}

/** `known` keys first in that order, then the rest in source order; nullish values dropped. */
function ordered(map: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of known) if (map[key] !== undefined && map[key] !== null) out[key] = map[key];
  for (const [key, value] of Object.entries(map))
    if (!(key in out) && value !== undefined && value !== null) out[key] = value;
  return out;
}

/** Every string on one line, as the non-claude hosts' dumper wrote them: newline runs become a space, trimmed. */
function flatten<T>(value: T): T {
  if (typeof value === "string") return value.replace(/\n+/g, " ").trim() as T;
  if (Array.isArray(value)) return value.map(flatten) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value as YamlMap).map(([key, item]) => [key, flatten(item)])) as T;
  }
  return value;
}

/** Fewer path segments first, then plain string order; merged paths are unique, so there is no tie. */
function shallowestFirst(a: Doc, b: Doc): number {
  const depth = a.file.split("/").length - b.file.split("/").length;
  return depth !== 0 ? depth : a.file < b.file ? -1 : 1;
}
