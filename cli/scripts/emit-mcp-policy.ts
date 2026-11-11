#!/usr/bin/env bun
/** Emit host MCP deny-default artifacts from agents/mcp-policy.jsonc and the servers of the user's own `.mcp.json`. */
import fs from "node:fs";
import path from "node:path";

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { readEnv } from "../env.ts";
import { parseMcpJson } from "../sync/parse-mcp-json.ts";
import { claudeCheckOk, codexCheckOk, grokCheckOk } from "./emit-mcp-check.ts";
import {
  desiredAgentsMcp,
  desiredClaudeSettings,
  desiredCodex,
  desiredGrok,
  isHomeGrokConfig,
  stringList,
  type Policy,
} from "./emit-mcp-hosts.ts";
import { deepEqual, isPlainObject, loadPolicy, validatePolicy } from "./emit-mcp-validate.ts";
import {
  AGENTS_MCP_REL,
  CLAUDE_SETTINGS_REL,
  CODEX_REL,
  GROK_REL,
  JSON_INDENT,
  MCP_JSON_REL,
  NOT_FOUND,
} from "./emit.constants.ts";
import { isRecord } from "./hook-input.ts";

type JsonObject = Record<string, unknown>;

export type EmitResult = {
  ok: boolean;
  check: boolean;
  error?: string;
  drift?: string[];
};

/** The roots and mode of one emit; see `emitMcpPolicy`. */
type EmitOptions = {
  workspaceRoot?: string;
  sourceRoot?: string;
  consumerRoot?: string;
  check?: boolean;
  home?: string;
};

/** One host file: the text on disk (null when missing), what it holds and what the policy wants there. */
type Host<D extends JsonObject = JsonObject> = {
  raw: string | null;
  disk: JsonObject;
  desired: D;
};

type Hosts = {
  grok: Host;
  claude: Host;
  codex: Host<JsonObject & { agents: JsonObject }>;
  agents: Host;
};

function readText(abs: string): string | null {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (err) {
    if (isRecord(err) && err.code === NOT_FOUND) return null;
    throw err;
  }
}

function parseJsonFile(raw: string | null): JsonObject {
  if (raw == null || !raw.trim()) return {};
  const v: unknown = JSON.parse(raw);
  return isPlainObject(v) ? v : {};
}

function parseTomlFile(raw: string | null): JsonObject {
  if (raw == null || !raw.trim()) return {};
  return parseToml(raw);
}

function writeText(abs: string, text: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const jsonOut = (obj: unknown): string => `${JSON.stringify(obj, null, JSON_INDENT)}\n`;

/** The validated policy with the servers of the consumer's `.mcp.json`, or the error that stops the emit. */
function policyOf(ws: string, opts: EmitOptions): { ok: true; policy: Policy } | { ok: false; error: string } {
  const rawPolicy = loadPolicy(opts.sourceRoot || ws, opts.consumerRoot);
  const valid = validatePolicy(rawPolicy);
  if (!valid.ok) return valid;
  const mcpJson = parseMcpJson(readText(path.join(opts.consumerRoot || ws, MCP_JSON_REL)));
  if (!mcpJson.ok) return { error: mcpJson.error, ok: false };
  const denyPlugins = isPlainObject(rawPolicy.plugins) && rawPolicy.plugins.denyDefault === true;
  return { ok: true, policy: { allow: stringList(rawPolicy.allow), denyPlugins, servers: mcpJson.servers } };
}

/** The four host files as they are and as `policy` makes them. */
function hostsOf(ws: string, policy: Policy, keepHomeTables: boolean): Hosts {
  const grokRaw = readText(path.join(ws, GROK_REL));
  const claudeRaw = readText(path.join(ws, CLAUDE_SETTINGS_REL));
  const codexRaw = readText(path.join(ws, CODEX_REL));
  const agentsRaw = readText(path.join(ws, AGENTS_MCP_REL));
  const grokDisk = parseTomlFile(grokRaw);
  const claudeDisk = parseJsonFile(claudeRaw);
  const codexDisk = parseTomlFile(codexRaw);
  return {
    agents: { desired: desiredAgentsMcp(policy), disk: parseJsonFile(agentsRaw), raw: agentsRaw },
    claude: { desired: desiredClaudeSettings(claudeDisk, policy), disk: claudeDisk, raw: claudeRaw },
    codex: { desired: desiredCodex(codexDisk, policy), disk: codexDisk, raw: codexRaw },
    grok: { desired: desiredGrok(grokDisk, policy, keepHomeTables), disk: grokDisk, raw: grokRaw },
  };
}

/** The host files whose disk text is missing or does not hold what the policy wants. */
function driftOf({ grok, claude, codex, agents }: Hosts, policy: Policy, keepHomeTables: boolean): string[] {
  const held: [string, boolean][] = [
    [GROK_REL, grok.raw != null && grokCheckOk(grok.disk, { desired: grok.desired, keepHomeTables, policy })],
    [CLAUDE_SETTINGS_REL, claude.raw != null && claudeCheckOk(claude.disk, claude.desired)],
    [CODEX_REL, codex.raw != null && codexCheckOk(codex.disk, codex.desired, policy.allow)],
    [AGENTS_MCP_REL, agents.raw != null && deepEqual(agents.disk, agents.desired)],
  ];
  return held.filter(([, ok]) => !ok).map(([rel]) => rel);
}

function writeHosts(ws: string, hosts: Hosts): void {
  writeText(path.join(ws, GROK_REL), stringifyToml(hosts.grok.desired));
  writeText(path.join(ws, CLAUDE_SETTINGS_REL), jsonOut(hosts.claude.desired));
  writeText(path.join(ws, CODEX_REL), stringifyToml(hosts.codex.desired));
  writeText(path.join(ws, AGENTS_MCP_REL), jsonOut(hosts.agents.desired));
}

/**
 * Reads the policy from `sourceRoot` (default `workspaceRoot`), merges `consumerRoot`'s own over it, takes the servers
 * of `consumerRoot`'s `.mcp.json` (default `workspaceRoot`'s), never writing that file, and writes under `workspaceRoot`.
 */
export function emitMcpPolicy(opts: EmitOptions = {}): EmitResult {
  const check = opts.check ?? false;
  const ws = opts.workspaceRoot || process.cwd();
  const resolved = policyOf(ws, opts);
  if (!resolved.ok) return { check, error: resolved.error, ok: false };
  const { policy } = resolved;
  const keepHomeTables = isHomeGrokConfig(ws, opts.home || readEnv().HOME);
  const hosts = hostsOf(ws, policy, keepHomeTables);
  if (!check) {
    writeHosts(ws, hosts);
    return { check: false, ok: true };
  }
  const drift = driftOf(hosts, policy, keepHomeTables);
  if (drift.length) return { check: true, drift, error: `drift: ${drift.join(", ")}`, ok: false };
  return { check: true, drift: [], ok: true };
}
