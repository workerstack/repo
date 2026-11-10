/** Who is calling: the child agent a payload names, and the session it belongs to. */
import type { HookAgent, HookInput } from "./hook-input.ts";
import { DEFAULT_SESSION, IMPLEMENTER_PREFIX, MAX_CHILD_TYPE_LENGTH, UUID_RE } from "./gate.constants.ts";
import { isHookObject, type Payload } from "./gate-harness.ts";

const CHILD_TYPE_KEYS = [
  "subagentType",
  "subagent_type",
  "agentType",
  "agent_type",
  "agentName",
  "agent_name",
] as const satisfies readonly (keyof HookInput)[];
const CHILD_ID_KEYS = ["agentId", "agent_id", "spawnedBy", "spawned_by"] as const satisfies readonly (keyof HookInput &
  keyof HookAgent)[];
const AGENT_ID_KEYS = [...CHILD_ID_KEYS, "id"] as const satisfies readonly (keyof HookAgent)[];
const AGENT_TYPE_KEYS = [
  "subagentType",
  "subagent_type",
  "type",
  "name",
  "agentType",
] as const satisfies readonly (keyof HookAgent)[];

function nonEmptyChildId(raw: unknown): boolean {
  if (raw == null) return false;
  return String(raw).trim() !== "";
}

/** The nested agent object of a payload, or null when it sends a name string, an array or nothing. */
function agentObjectOf(data: HookInput): HookAgent | null {
  const { agent } = data;
  return agent && typeof agent === "object" && !Array.isArray(agent) ? agent : null;
}

/** True when PreToolUse names a child session (UUID ok). Not a fat-gate type. */
export function hasChildAgentMarker(data: Payload): boolean {
  if (!isHookObject(data)) return false;
  if (CHILD_ID_KEYS.some((k) => nonEmptyChildId(data[k]))) return true;
  const agent = agentObjectOf(data);
  return agent !== null && AGENT_ID_KEYS.some((k) => nonEmptyChildId(agent[k]));
}

/** A lowercased agent type, or "" for an id, a number, a path or anything too long to be a name. */
function coerceChildType(raw: unknown): string {
  if (raw == null) return "";
  const s = String(raw).trim().toLowerCase();
  if (UUID_RE.test(s) || /^[0-9]+$/.test(s)) return "";
  if (s.length > MAX_CHILD_TYPE_LENGTH || /[\/\\]/.test(s)) return "";
  return s;
}

/** The first key of `source` that holds an agent type, else "". */
function firstType<T>(source: T, keys: readonly (keyof T)[]): string {
  for (const k of keys) {
    const t = coerceChildType(source[k]);
    if (t) return t;
  }
  return "";
}

export function subagentTypeOf(data: Payload): string {
  if (!isHookObject(data)) return "";
  const top = firstType(data, [...CHILD_TYPE_KEYS, ...CHILD_ID_KEYS]);
  if (top) return top;
  const agent = agentObjectOf(data);
  if (agent) return firstType(agent, AGENT_TYPE_KEYS);
  return typeof data.agent === "string" ? coerceChildType(data.agent) : "";
}

export function isParentOrchestrator(data: Payload): boolean {
  return !subagentTypeOf(data) && !hasChildAgentMarker(data);
}

/** True for a child spawned from an implementer-* agent. */
export function isImplementer(sub: unknown): boolean {
  return String(sub).startsWith(IMPLEMENTER_PREFIX);
}

// Antigravity sends its session id only as `conversationId` (phase 6 probe).
export function sessionIdOf(data: Payload): string {
  const sid = String((data && (data.sessionId || data.session_id || data.conversationId)) || "").trim();
  return sid === DEFAULT_SESSION ? "" : sid;
}
