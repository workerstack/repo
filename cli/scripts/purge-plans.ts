/** What `repo purge-mcps` would change in each global dest, planned without writing. */
import fs from "node:fs";

import { parse as parseToml } from "smol-toml";
import { z } from "zod";

import { isRecord, tryJson, type JsonObject } from "../json.ts";
import {
  ALREADY_CLEAN,
  CURSOR_SERVER,
  DISABLE_MCP,
  MCP_KEY,
  MISSING,
  NOT_FOUND,
  PLUGIN_IDS,
  STRIPE_PLUGIN,
} from "./purge-global-mcps.constants.ts";
import type { GrokPlan, JsonPlan } from "./purge-global-mcps.types.ts";
import { claudePluginsPath, cursorMcpPath, grokConfigPath } from "./purge-paths.ts";

function unreadable(abs: string): Error {
  return new Error(`unreadable dest: ${abs}`);
}

function isStripePluginKey(k: unknown): boolean {
  return String(k).split("@")[0] === STRIPE_PLUGIN;
}

function strList(v: unknown, label: string): string[] {
  if (v == null) return [];

  if (!Array.isArray(v)) throw unreadable(label);

  return v.map((x) => String(x));
}

function dedupe(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const x of list) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }

  return out;
}

/** The text of `abs`, or null when it does not exist; any other read failure makes it unreadable. */
function readDest(abs: string): string | null {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (err) {
    if (isRecord(err) && err.code === NOT_FOUND) return null;
    throw unreadable(abs);
  }
}

function parseJsonObject(raw: string, abs: string): JsonObject {
  const parsed = tryJson(z.record(z.string(), z.unknown()), raw);

  if (parsed === undefined) throw unreadable(abs);

  return parsed;
}

function parseTomlObject(raw: string, abs: string): JsonObject {
  try {
    return parseToml(raw);
  } catch {
    throw unreadable(abs);
  }
}

/** A copy of the config's [plugins] table, {} when it has none; a [plugins] that is no table is unreadable. */
function pluginsOf(obj: JsonObject, abs: string): JsonObject {
  if (isRecord(obj.plugins)) return { ...obj.plugins };

  if (obj.plugins != null) throw unreadable(abs);

  return {};
}

/** Moves PLUGIN_IDS from [plugins].enabled to [plugins].disabled on `next`; returns what changed. */
function grokPlugins(obj: JsonObject, next: JsonObject, abs: string): string[] {
  const plugins = pluginsOf(obj, abs);
  const enabled = strList(plugins.enabled, abs);
  const disabled = strList(plugins.disabled, abs);
  const nextEnabled = enabled.filter((n) => !PLUGIN_IDS.includes(n));
  const nextDisabled = dedupe([...disabled, ...PLUGIN_IDS]);
  const isEnabledChanged = nextEnabled.join("\0") !== enabled.join("\0");
  const isDisabledChanged = nextDisabled.join("\0") !== disabled.join("\0");
  const details: string[] = [];

  if (isEnabledChanged)
    details.push(`remove ${enabled.filter((n) => PLUGIN_IDS.includes(n)).join(", ")} from [plugins].enabled`);

  if (isDisabledChanged)
    details.push(`add ${PLUGIN_IDS.filter((id) => !disabled.includes(id)).join(", ")} to [plugins].disabled`);

  if (isEnabledChanged || isDisabledChanged) {
    if ("enabled" in plugins || isEnabledChanged) plugins.enabled = nextEnabled;
    plugins.disabled = nextDisabled;
    next.plugins = plugins;
  }

  return details;
}

/** Adds DISABLE_MCP to a list (or missing) disabled_mcp_servers on `next`; returns what changed. */
function grokMcp(next: JsonObject, abs: string): string[] {
  const current = next[MCP_KEY];

  if (current != null && !Array.isArray(current)) return [];
  const cur = strList(current, abs);
  const mcpNext = dedupe([...cur, ...DISABLE_MCP]);

  if (mcpNext.join("\0") === cur.join("\0")) return [];
  const added = mcpNext.filter((x) => !cur.includes(x));
  next[MCP_KEY] = mcpNext;

  return [`add ${added.join(", ")} to ${MCP_KEY}`];
}

/** The grok config's plan: PLUGIN_IDS disabled, DISABLE_MCP listed. */
export function planGrok(home: string): GrokPlan {
  const abs = grokConfigPath(home);
  const raw = readDest(abs);

  if (raw === null) return { abs, detail: MISSING, obj: null, skip: true };
  const obj = parseTomlObject(raw, abs);
  const next = { ...obj };
  const details = grokPlugins(obj, next, abs);
  details.push(...grokMcp(next, abs));
  const isChanged = details.length > 0;
  const detail = isChanged ? details.join("; ") : ALREADY_CLEAN;

  return { abs, changed: isChanged, detail, obj: next, skip: !isChanged };
}

function noop(abs: string, detail: string): JsonPlan {
  return { abs, detail, json: null, skip: true };
}

/** The claude plugin list's plan: every `stripe@…` key removed; the plugin cache stays. */
export function planClaudePlugins(home: string): JsonPlan {
  const abs = claudePluginsPath(home);
  const raw = readDest(abs);

  if (raw === null) return noop(abs, MISSING);
  const obj = parseJsonObject(raw, abs);
  const plugins = obj.plugins;

  if (plugins == null) return noop(abs, ALREADY_CLEAN);

  if (!isRecord(plugins)) throw unreadable(abs);
  const keys = Object.keys(plugins).filter(isStripePluginKey);

  if (keys.length === 0) return noop(abs, ALREADY_CLEAN);
  const nextPlugins = { ...plugins };

  for (const k of keys) delete nextPlugins[k];
  const json = { ...obj, plugins: nextPlugins };

  return { abs, changed: true, detail: `remove ${keys.join(", ")} from plugins`, json, skip: false };
}

/** The cursor MCP config's plan: CURSOR_SERVER removed from mcpServers. */
export function planCursor(home: string): JsonPlan {
  const abs = cursorMcpPath(home);
  const raw = readDest(abs);

  if (raw === null) return noop(abs, MISSING);
  const obj = parseJsonObject(raw, abs);
  const servers = obj.mcpServers;

  if (servers == null) return noop(abs, ALREADY_CLEAN);

  if (!isRecord(servers)) throw unreadable(abs);

  if (!Object.prototype.hasOwnProperty.call(servers, CURSOR_SERVER)) return noop(abs, ALREADY_CLEAN);
  const nextServers = { ...servers };
  delete nextServers[CURSOR_SERVER];
  const json = { ...obj, mcpServers: nextServers };

  return { abs, changed: true, detail: `remove ${CURSOR_SERVER} from mcpServers`, json, skip: false };
}
