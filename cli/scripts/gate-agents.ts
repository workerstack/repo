import { isHookObject, type Payload } from "./gate-harness.ts";
import { DEFAULT_SESSION, IMPLEMENTER_PREFIX, MAX_CHILD_TYPE_LENGTH, UUID_RE } from "./gate.constants.ts";
/** Who is calling: the child agent a payload names, and the session it belongs to. */
import type { HookAgent, HookInput } from "./hook-input.ts";

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
/** A bare number, which names an id rather than an agent type. */
const DIGITS_RE = /^[0-9]+$/;
/** A path separator, which names a file rather than an agent type. */
const PATH_SEP_RE = /[/\\]/;

function nonEmptyChildId(raw: string | undefined): boolean {
  return raw !== undefined && raw.trim() !== "";
}

/** The nested agent object of a payload, or null when it sends a name string, an array or nothing. */
function agentObjectOf(data: HookInput): HookAgent | null {
  const { agent } = data;
  return typeof agent === "object" && !Array.isArray(agent) ? agent : null;
}

/** True when PreToolUse names a child session (UUID ok). Not a fat-gate type. */
export function hasChildAgentMarker(data: Payload): boolean {
  if (!isHookObject(data)) return false;
  if (CHILD_ID_KEYS.some((k) => nonEmptyChildId(data[k]))) return true;
  const agent = agentObjectOf(data);
  return agent !== null && AGENT_ID_KEYS.some((k) => nonEmptyChildId(agent[k]));
}

/** A lowercased agent type, or "" for an id, a number, a path or anything too long to be a name. */
function coerceChildType(raw: string | undefined): string {
  if (raw === undefined) return "";
  const s = raw.trim().toLowerCase();
  if (UUID_RE.test(s) || DIGITS_RE.test(s)) return "";
  if (s.length > MAX_CHILD_TYPE_LENGTH || PATH_SEP_RE.test(s)) return "";
  return s;
}

/** The first key of `source` that holds an agent type, else "". */
function firstType<K extends string>(source: Partial<Record<K, string>>, keys: readonly K[]): string {
  for (const k of keys) {
    const t = coerceChildType(source[k]);
    if (t !== "") return t;
  }
  return "";
}

export function subagentTypeOf(data: Payload): string {
  if (!isHookObject(data)) return "";
  const top = firstType(data, [...CHILD_TYPE_KEYS, ...CHILD_ID_KEYS]);
  if (top !== "") return top;
  const agent = agentObjectOf(data);
  if (agent !== null) return firstType(agent, AGENT_TYPE_KEYS);
  return typeof data.agent === "string" ? coerceChildType(data.agent) : "";
}

export function isParentOrchestrator(data: Payload): boolean {
  return subagentTypeOf(data) === "" && !hasChildAgentMarker(data);
}

/** True for a child spawned from an implementer-* agent. */
export function isImplementer(sub: unknown): boolean {
  return String(sub).startsWith(IMPLEMENTER_PREFIX);
}

// Antigravity sends its session id only as `conversationId` (phase 6 probe).
export function sessionIdOf(data: Payload): string {
  const raw = [data?.sessionId, data?.session_id, data?.conversationId].find(Boolean) ?? "";
  const sid = raw.trim();
  return sid === DEFAULT_SESSION ? "" : sid;
}
