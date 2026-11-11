/** Loading and validating the MCP policy, and the deep compares its checks run. */
import fs from "node:fs";
import path from "node:path";

import { AGENT_IDS, CONSUMER_POLICY_REL, POLICY_DEFAULT, POLICY_REL } from "./emit.constants.ts";
import { stripJsonc } from "./jsonc.ts";

type JsonObject = Record<string, unknown>;

/** A record that is not an array or a TOML date. */
export function isPlainObject(v: unknown): v is JsonObject {
  return v != null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
}

function objectsEqual(a: JsonObject, b: JsonObject): boolean {
  const ak = Object.keys(a);
  return ak.length === Object.keys(b).length && ak.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a == null || b == null) return false;
  if (Array.isArray(a)) return Array.isArray(b) && arraysEqual(a, b);
  if (typeof a !== "object") return false;
  return isPlainObject(a) && isPlainObject(b) && objectsEqual(a, b);
}

/** desired keys must be present on disk; extra disk keys allowed. */
export function requiredDeepMatch(disk: unknown, desired: unknown): boolean {
  if (Array.isArray(desired)) return deepEqual(disk, desired);
  if (desired != null && typeof desired === "object") {
    if (!isPlainObject(disk)) return false;
    return Object.entries(desired).every(([k, v]) => requiredDeepMatch(disk[k], v));
  }
  return deepEqual(disk, desired);
}

function readPolicyFile(p: string): JsonObject {
  const policy: unknown = JSON.parse(stripJsonc(fs.readFileSync(p, "utf8")));
  if (!isPlainObject(policy)) {
    throw new Error("invalid policy");
  }
  return policy;
}

/** `over` onto `base`: objects merge key by key, anything else (arrays included) is replaced. */
function mergePolicy(base: JsonObject, over: JsonObject): JsonObject {
  const out: JsonObject = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const prev = out[k];
    out[k] = isPlainObject(prev) && isPlainObject(v) ? mergePolicy(prev, v) : v;
  }
  return out;
}

/** The stock policy at `<sourceRoot>/agents/mcp-policy.jsonc`, with `<consumerRoot>/.repo/mcp-policy.jsonc` merged over it when given and present. */
export function loadPolicy(sourceRoot?: string, consumerRoot?: string): JsonObject {
  const stock = readPolicyFile(path.join(sourceRoot || process.cwd(), POLICY_REL));
  if (!consumerRoot) return stock;
  const own = path.join(consumerRoot, CONSUMER_POLICY_REL);
  return fs.existsSync(own) ? mergePolicy(stock, readPolicyFile(own)) : stock;
}

/** The first agent row that does not set `inherit: false`, as its error; null when every row does. */
function agentsError(policy: JsonObject): string | null {
  const agents = policy.agents;
  if (agents == null) return null;
  if (!isPlainObject(agents)) return "agents must be an object";
  const bad = AGENT_IDS.find((id) => {
    const row = agents[id];
    return row != null && (!isPlainObject(row) || row.inherit !== false);
  });
  return bad === undefined ? null : `agents.${bad}.inherit must be false`;
}

const nonEmptyStrings = (v: unknown): boolean =>
  Array.isArray(v) && v.every((name) => typeof name === "string" && name !== "");

/** The field checks in order: each returns the policy's error, or null when its field holds. */
const CHECKS: readonly ((policy: JsonObject) => string | null)[] = [
  (p) => (p.default === POLICY_DEFAULT ? null : 'default must be "deny"'),
  (p) => (Array.isArray(p.allow) ? null : "allow must be an array"),
  (p) => (nonEmptyStrings(p.allow) ? null : "allow names must be non-empty strings"),
  (p) => (Object.hasOwn(p, "servers") ? "mcp-policy.jsonc: servers moved to .mcp.json; run `bun repo sync`" : null),
  agentsError,
];

export function validatePolicy(policy: unknown): { ok: true } | { ok: false; error: string } {
  if (!isPlainObject(policy)) return { error: "invalid policy", ok: false };
  for (const check of CHECKS) {
    const error = check(policy);
    if (error !== null) return { error, ok: false };
  }
  return { ok: true };
}
