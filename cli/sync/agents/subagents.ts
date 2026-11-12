/**
 * Subagent files for each enabled host, from one set of subagent sources. A source names its hosts with
 * `targets` (default all) and carries one block per host (`claudecode:`, `codexcli:`, `antigravity-cli:`,
 * `grokcli:`, `cursor:`); top-level keys the hosts do not read (`tier`, `exec`) are ignored.
 */
import { stringify } from "smol-toml";

import type { Host } from "../../config.ts";
import { isRecord } from "../../json.ts";
import { type YamlMode, type YamlValue, emitYaml, finalize } from "./frontmatter.ts";
import { AFTER, BEFORE, MD_SUFFIX } from "./sources.constants.ts";
import type { Doc, Sources } from "./sources.types.ts";

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

  for (const doc of sources.subagents.toSorted(shallowestFirst)) {
    const name = doc.data["name"];

    if (typeof name !== "string") throw new Error(`${doc.rel}: invalid frontmatter: name must be a string`);
    const nested = doc.file.includes("/");

    for (const host of hosts) {
      if (!targets(doc, TARGET[host]) || (nested && host !== "claude")) continue;
      const [rel, text] = RENDER[host]({ doc, name });
      out.set(rel, finalize(text));
    }
  }

  return out;
}

/** One subagent being rendered: its source and the name its frontmatter gives. */
type Agent = { doc: Doc; name: string };

type Rendered = [string, string];

function own(data: Doc["data"], key: string): Record<string, unknown> {
  return without(block(data[key]), "name", "description");
}

function claudeAgent({ doc, name }: Agent): Rendered {
  const fm = ordered({ description: doc.data["description"], name, ...own(doc.data, "claudecode") }, CLAUDE_KEYS);

  return [`.claude/agents/${doc.file}`, markdown(fm, doc.body, "claude")];
}

function antigravityAgent({ doc, name }: Agent): Rendered {
  const merged = { ...block(doc.data["antigravity-ide"]), ...block(doc.data["antigravity-cli"]) };
  const description = doc.data["description"] ?? `${name} subagent`;
  const fm = { description, name, ...without(merged, "name", "description") };

  return [`.agents/agents/${doc.file}`, markdown(flatten(ordered(fm, ANTIGRAVITY_KEYS)), doc.body, "default")];
}

function flatAgent(dir: string, key: string, { doc, name }: Agent): Rendered {
  const fm = flatten({ description: doc.data["description"], name, ...block(doc.data[key]) });

  return [`${dir}/agents/${doc.file}`, markdown(fm, doc.body, "default")];
}

function codexAgent({ doc, name }: Agent): Rendered {
  const description: unknown = doc.data["description"];
  const rest: Record<string, unknown> = { name, ...(isTruthy(description) ? { description } : {}) };
  Object.assign(
    rest,
    without(block(doc.data["codexcli"]), "name", "description", "developer_instructions", "short-description"),
  );

  return [`.codex/agents/${doc.file.replace(MD_SUFFIX, ".toml")}`, codexToml(rest, doc.body)];
}

/** Whether `value` is truthy, as a plain `if (value)` reads it. */
function isTruthy(value: unknown): boolean {
  return Boolean(value);
}

const RENDER: Readonly<Record<Host, (agent: Agent) => Rendered>> = {
  antigravity: antigravityAgent,
  claude: claudeAgent,
  codex: codexAgent,
  cursor: (agent) => flatAgent(".cursor", TARGET.cursor, agent),
  grok: (agent) => flatAgent(".grok", TARGET.grok, agent),
};

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
  const entries = Object.entries(fm) /* frontmatter values come from parsed YAML */ as [string, YamlValue][];

  return `---\n${emitYaml(entries, mode)}---\n${body}\n`;
}

function targets(doc: Doc, target: string): boolean {
  const list = doc.data["targets"];

  if (list === undefined) return true;
  const names = Array.isArray(list) ? list : [list];

  return names.includes("*") || names.includes(target);
}

function block(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** A run of newlines, which the non-claude dumper wrote as one space. */
const NEWLINE_RUNS = /\n+/g;

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
  return flattened(value) /* flattening keeps the shape: strings stay strings, lists lists, maps maps */ as T;
}

function flattened(value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll(NEWLINE_RUNS, " ").trim();

  if (Array.isArray(value)) return value.map(flattened);

  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, flattened(item)]));

  return value;
}

/** Fewer path segments first, then plain string order; merged paths are unique, so there is no tie. */
function shallowestFirst(a: Doc, b: Doc): number {
  const depth = a.file.split("/").length - b.file.split("/").length;

  if (depth !== 0) return depth;

  return a.file < b.file ? BEFORE : AFTER;
}
