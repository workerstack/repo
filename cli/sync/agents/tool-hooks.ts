/** A matcher-group host's hooks from the merged hooks.jsonc. `D:<n>` cites rulesync 43.7.0's bundled import code. */
import { expandHookCommand } from "../../scripts/hook-command.ts";
import { AGENT, COMMAND, HTTP, MCP_TOOL, MODEL, PROMPT } from "./hooks.constants.ts";
import type { Def, Group, Json, Target } from "./hooks.types.ts";
import { passthroughFields } from "./passthrough-fields.ts";

type DefsByEvent = Record<string, Def[]>;

type EventNames = Readonly<Record<string, string>>;

/** The payload fields each handler kind carries after its common ones; `model` only where the target emits it. */
const PAYLOAD: Readonly<Record<string, readonly string[]>> = {
  [AGENT]: [MODEL],
  [HTTP]: ["url", "headers", "allowedEnvVars"],
  [MCP_TOOL]: ["server", "tool", "input"],
  [PROMPT]: [MODEL],
};

const NAMED: readonly string[] = ["name", "description"];

/**
 * The host's name for an event; an override event it has none for keeps its own (`lookupOwn … ?? eventName`,
 * D:53765-53768).
 */
export function nameOf(names: EventNames, event: string): string {
  return Object.hasOwn(names, event) ? (names[event] /* hasOwn proved the key */ as string) : event;
}

/** A definition's handler kind; a definition without one is a command. */
export function typeOf(def: Def): string {
  const type = def["type"] /* hooks.jsonc types are strings; another value matches no kind */ as string | undefined;

  return type ?? COMMAND;
}

/**
 * Shared events the host names, in source order, then `{...shared, ...override}`; overrides are unfiltered
 * (D:53170-53178).
 */
export function effectiveEvents(config: Json, overrideKey: string, names: EventNames): [string, Def[]][] {
  const hooks = config["hooks"] /* hooks.jsonc's hooks map events to definition lists */ as DefsByEvent | undefined;
  const shared = Object.entries(hooks ?? {}).filter(([event]) => Object.hasOwn(names, event));
  const block = config[overrideKey] /* an override block holds a hooks map */ as { hooks?: DefsByEvent } | undefined;

  return Object.entries({ ...Object.fromEntries(shared), ...block?.hooks });
}

/**
 * Passthrough fields, `type`, `command`, `timeout`, `prompt`, the type's payload, then codex's `name`/`description`
 * (D:53698-53735, D:53598-53612).
 */
function hookObject(def: Def, event: string, target: Readonly<Target>): Json {
  const type = typeOf(def);
  const source = typeof def["command"] === "string" ? expandHookCommand(def["command"]) : def["command"];
  const command = typeof source === "string" && target.command !== undefined ? target.command(source, def) : source;

  const fields: Json = {
    ...passthroughFields({ def, event, target, type }),
    command,
    prompt: def["prompt"],
    timeout: def["timeout"],
    type,
  };

  const payload = (PAYLOAD[type] ?? []).filter((key) => key !== MODEL || target.promptModel);

  for (const key of [...payload, ...(target.named ? NAMED : [])]) fields[key] = def[key];

  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null));
}

/** The definitions of one event grouped by (translated) matcher, in first-appearance order. */
function byMatcher(defs: readonly Def[], event: string, target: Readonly<Target>): Map<string, Def[]> {
  const groups = new Map<string, Def[]>();

  for (const def of defs) {
    const raw = (def["matcher"] /* hooks.jsonc matchers are strings */ as string | undefined) ?? "";

    const matcher =
      raw === "" || target.noMatcher.has(event) || target.matcher === undefined ? raw : target.matcher(raw);

    groups.set(matcher, [...(groups.get(matcher) ?? []), def]);
  }

  return groups;
}

/**
 * Per event, defs grouped by (translated) matcher in first-appearance order (D:53186-53215): `{matcher, hooks}`,
 * or `{hooks}` when the matcher is empty or the event takes none. Groups left without a writable hook, and events
 * left without a group, are dropped (D:53756-53800).
 */
export function toolHooks(config: Json, target: Readonly<Target>): Record<string, Group[]> {
  const out: Record<string, Group[]> = {};

  for (const [event, defs] of effectiveEvents(config, target.overrideKey, target.names)) {
    const noMatcher = target.noMatcher.has(event);
    const entries: Group[] = [];

    for (const [matcher, group] of byMatcher(defs, event, target)) {
      const hooks = group.filter((def) => target.types.has(typeOf(def))).map((def) => hookObject(def, event, target));

      if (hooks.length === 0) continue;
      entries.push(matcher === "" || noMatcher ? { hooks } : { hooks, matcher });
    }

    if (entries.length > 0) out[nameOf(target.names, event)] = entries;
  }

  return out;
}
