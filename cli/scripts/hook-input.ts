/**
 * The stdin payload every hook entry receives. Claude, Codex, Cursor, Grok and Antigravity spell the same
 * facts differently, so each spelling is its own optional field.
 */

/** Antigravity's tool call: the tool name and its arguments. */
type HookToolCall = {
  name?: string;
  args?: Record<string, unknown>;
};

/** The nested agent object some harnesses send in place of flat agent fields. */
export type HookAgent = {
  id?: string;
  type?: string;
  name?: string;
  subagentType?: string;
  subagent_type?: string;
  agentType?: string;
  agentId?: string;
  agent_id?: string;
  spawnedBy?: string;
  spawned_by?: string;
};

export type HookInput = {
  session_id?: string;
  sessionId?: string;
  conversationId?: string;
  cwd?: string;
  /** The workspace the harness works in: Grok and Cursor send one string, Antigravity a list. */
  workspaceRoot?: string;
  workspace_root?: string;
  workspacePaths?: string[];
  hook_event_name?: string;
  hookEventName?: string;
  tool_name?: string;
  toolName?: string;
  /** Shape varies per tool; callers narrow it. */
  tool_input?: Record<string, unknown>;
  toolInput?: Record<string, unknown>;
  /** Antigravity's call, instead of the tool name and input fields. */
  toolCall?: HookToolCall;
  transcript_path?: string;
  transcriptPath?: string;
  prompt?: string;
  userPrompt?: string;
  user_prompt?: string;
  content?: string;
  lastUserInput?: string;
  last_assistant_message?: string;
  lastAssistantMessage?: string;
  reason?: string;
  stop_hook_active?: boolean;
  stopHookActive?: boolean;
  agent_type?: string;
  agentType?: string;
  agent_name?: string;
  agentName?: string;
  subagent_type?: string;
  subagentType?: string;
  agent_id?: string;
  agentId?: string;
  spawned_by?: string;
  spawnedBy?: string;
  /** A name string (Grok) or a nested object (Cursor). */
  agent?: string | HookAgent;
  /** Present only on Cursor payloads. */
  cursor_version?: string;
  /** Codex sends turn_id and model on every tool hook. */
  turn_id?: string;
  model?: string;
  /** Claude WorktreeCreate: the requested worktree name. */
  name?: string;
  /** Claude WorktreeRemove: the worktree directory. */
  worktree_path?: string;
};

const STRING_FIELDS = [
  "session_id",
  "sessionId",
  "conversationId",
  "cwd",
  "workspaceRoot",
  "workspace_root",
  "hook_event_name",
  "hookEventName",
  "tool_name",
  "toolName",
  "transcript_path",
  "transcriptPath",
  "prompt",
  "userPrompt",
  "user_prompt",
  "content",
  "lastUserInput",
  "last_assistant_message",
  "lastAssistantMessage",
  "reason",
  "agent_type",
  "agentType",
  "agent_name",
  "agentName",
  "subagent_type",
  "subagentType",
  "agent_id",
  "agentId",
  "spawned_by",
  "spawnedBy",
  "cursor_version",
  "turn_id",
  "model",
  "name",
  "worktree_path",
] as const;

const AGENT_FIELDS = [
  "id",
  "type",
  "name",
  "subagentType",
  "subagent_type",
  "agentType",
  "agentId",
  "agent_id",
  "spawnedBy",
  "spawned_by",
] as const;

const BOOLEAN_FIELDS = ["stop_hook_active", "stopHookActive"] as const;

const TOOL_INPUT_FIELDS = ["tool_input", "toolInput"] as const;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Copies each key of `keys` whose value in `from` passes `keep`. */
function copyWhere<K extends string, V>(
  from: Record<string, unknown>,
  keys: readonly K[],
  keep: (v: unknown) => v is V,
): Partial<Record<K, V>> {
  const out: Partial<Record<K, V>> = {};
  for (const key of keys) {
    const v = from[key];
    if (keep(v)) out[key] = v;
  }
  return out;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

/**
 * The string fields, the workspace paths, the boolean flags and the tool inputs that hold their type,
 * in that order.
 */
function flatFields(value: Record<string, unknown>): HookInput {
  const paths = value.workspacePaths;
  return {
    ...copyWhere(value, STRING_FIELDS, isString),
    ...(Array.isArray(paths) ? { workspacePaths: paths.filter(isString) } : {}),
    ...copyWhere(value, BOOLEAN_FIELDS, isBoolean),
    ...copyWhere(value, TOOL_INPUT_FIELDS, isRecord),
  };
}

/** Antigravity's call with its string name and record args kept. */
function toolCallOf(call: Record<string, unknown>): HookToolCall {
  const toolCall: HookToolCall = {};
  if (isString(call.name)) toolCall.name = call.name;
  if (isRecord(call.args)) toolCall.args = call.args;
  return toolCall;
}

/** The agent as a name string, or the nested object with its string fields kept. */
function agentOf(agent: unknown): string | HookAgent | undefined {
  if (isString(agent)) return agent;
  if (!isRecord(agent)) return undefined;
  return copyWhere(agent, AGENT_FIELDS, isString);
}

/** The JSON value of `raw`, or undefined when it does not parse. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Parses stdin text into a HookInput, or null when it is not JSON or not an object.
 * A field whose type is wrong is dropped; the rest are kept.
 */
export function parseHookInput(raw: string): HookInput | null {
  const value = parseJson(raw);
  if (!isRecord(value)) return null;
  const out = flatFields(value);
  if (isRecord(value.toolCall)) out.toolCall = toolCallOf(value.toolCall);
  const agent = agentOf(value.agent);
  if (agent !== undefined) out.agent = agent;
  return out;
}
