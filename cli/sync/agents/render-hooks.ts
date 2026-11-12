/**
 * The four hook files, from the merged `hooks.jsonc`: `.claude/settings.json`, `.codex/hooks.json`,
 * `.agents/hooks.json` and `.cursor/hooks.json`, in the shapes rulesync 43.7.0 wrote. Grok's hook configs are
 * static stock files. Each host sees the shared events it supports in source order, then its own override block
 * (`claudecode`, `codexcli`, `antigravity-cli`, `cursor`): a same event is replaced in place, new ones go last.
 * `D:<n>` cites a line of rulesync 43.7.0's bundled `dist/import-*.js`.
 */
import type { Host } from "../../config.ts";
import { expandHookCommand } from "../../scripts/hook-command.ts";
import { ANTIGRAVITY, CLAUDE, CODEX } from "./hook-targets.ts";
import {
  ANTIGRAVITY_FILE,
  ANTIGRAVITY_FLAT,
  CLAUDE_FILE,
  CLAUDE_SCHEMA,
  CODEX_FILE,
  CURSOR_EVENTS,
  CURSOR_FILE,
  CURSOR_KEY,
  CURSOR_TYPES,
  CURSOR_VERSION,
  JSON_INDENT,
  LOOP_LIMIT,
  MCP_TOOL,
  PROMPT,
} from "./hooks.constants.ts";
import type { Def, Group, Json } from "./hooks.types.ts";
import type { Sources } from "./sources.types.ts";
import { effectiveEvents, nameOf, toolHooks, typeOf } from "./tool-hooks.ts";

function text(value: unknown): string {
  return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}

function containsNull(value: unknown): boolean {
  if (value === null) return true;

  return typeof value === "object" && Object.values(value).some(containsNull);
}

/** Why Codex would refuse a handler, or undefined (`describeRejectedHandler`, D:56419-56429). */
function codexRejects(hook: Json): boolean {
  const { timeout } = hook;

  if (timeout !== undefined && !(typeof timeout === "number" && Number.isSafeInteger(timeout) && timeout >= 0))
    return true;

  if (hook["type"] !== MCP_TOOL) return false;

  return (
    [hook["server"], hook["tool"]].some((value) => typeof value !== "string" || value === "") ||
    containsNull(hook["input"])
  );
}

/** Drops handlers Codex rejects, then emptied groups and events (`filterCodexHandlers`, D:56436-56462). */
function filterCodexHandlers(hooks: Record<string, Group[]>): Record<string, Group[]> {
  const out: Record<string, Group[]> = {};

  for (const [event, groups] of Object.entries(hooks)) {
    const kept = groups
      .map((group) => ({ ...group, hooks: group.hooks.filter((hook) => !codexRejects(hook)) }))
      .filter((group) => group.hooks.length > 0);

    if (kept.length > 0) out[event] = kept;
  }

  return out;
}

/** The stock settings with `hooks` replaced in place (else appended) and `$schema` first when missing. */
function claudeSettings(base: string, hooks: Json): Json {
  const settings: Json = { ...(JSON.parse(base) /* the stock claude settings file is a JSON object */ as Json), hooks };

  return "$schema" in settings ? settings : { $schema: CLAUDE_SCHEMA, ...settings };
}

/**
 * One cursor entry: `type` only when the source has one, `model` only on prompt handlers; `loop_limit` kept when
 * null.
 */
function cursorEntry(def: Def): Json {
  const { type, command, timeout, matcher, prompt, model, failClosed } = def;

  const entry = {
    command: typeof command === "string" ? expandHookCommand(command) : command,
    failClosed,
    loop_limit: def[LOOP_LIMIT],
    matcher,
    model: type === PROMPT ? model : undefined,
    prompt,
    timeout,
    type,
  };

  return Object.fromEntries(
    Object.entries(entry).filter(([key, value]) => value !== undefined && (value !== null || key === LOOP_LIMIT)),
  );
}

/**
 * Cursor's flat entries, no grouping (D:57912-57936): command and prompt handlers only; events left empty are
 * dropped.
 */
function cursorHooks(config: Json): Json {
  const out: Json = {};

  for (const [event, defs] of effectiveEvents(config, CURSOR_KEY, CURSOR_EVENTS)) {
    const mapped = defs.filter((def) => CURSOR_TYPES.has(typeOf(def))).map(cursorEntry);

    if (mapped.length > 0) out[nameOf(CURSOR_EVENTS, event)] = mapped;
  }

  return out;
}

/** Antigravity's file: its flat events as bare handler lists, `{}` when no event is left. */
function antigravityFile(config: Json): Json {
  const flat = Object.entries(toolHooks(config, ANTIGRAVITY)).map(([event, groups]) => [
    event,
    ANTIGRAVITY_FLAT.has(event) ? groups.flatMap((group) => group.hooks) : groups,
  ]);

  return flat.length === 0 ? {} : { rulesync: Object.fromEntries(flat) };
}

/** Path to text for each enabled host's hook file; `claudeBase` is the stock `agents/settings/claude.json`. */
export function renderHooks(sources: Sources, hosts: readonly Host[], claudeBase: string): Map<string, string> {
  const config = sources.hooks.value;
  const files = new Map<string, string>();

  if (hosts.includes("claude")) files.set(CLAUDE_FILE, text(claudeSettings(claudeBase, toolHooks(config, CLAUDE))));

  if (hosts.includes("codex")) files.set(CODEX_FILE, text({ hooks: filterCodexHandlers(toolHooks(config, CODEX)) }));

  if (hosts.includes("antigravity")) files.set(ANTIGRAVITY_FILE, text(antigravityFile(config)));

  if (hosts.includes("cursor"))
    files.set(CURSOR_FILE, text({ hooks: cursorHooks(config), version: config["version"] ?? CURSOR_VERSION }));

  return files;
}
