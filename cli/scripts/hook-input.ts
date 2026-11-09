/** The stdin payload every hook entry receives. Claude, Codex, Cursor, Grok and Antigravity spell the same facts differently, so each spelling is its own optional field. */

/** Antigravity's tool call: the tool name and its arguments. */
export interface HookToolCall {
  name?: string;
  args?: Record<string, unknown>;
}

/** The nested agent object some harnesses send in place of flat agent fields. */
export interface HookAgent {
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
}

export interface HookInput {
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
}

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

/** Parses stdin text into a HookInput, or null when it is not JSON or not an object. A field whose type is wrong is dropped; the rest are kept. */
export function parseHookInput(raw: string): HookInput | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const out: HookInput = {};
  for (const key of STRING_FIELDS) {
    const v = value[key];
    if (typeof v === "string") out[key] = v;
  }
  if (Array.isArray(value.workspacePaths)) {
    out.workspacePaths = value.workspacePaths.filter((p): p is string => typeof p === "string");
  }
  for (const key of BOOLEAN_FIELDS) {
    const v = value[key];
    if (typeof v === "boolean") out[key] = v;
  }
  for (const key of TOOL_INPUT_FIELDS) {
    const v = value[key];
    if (isRecord(v)) out[key] = v;
  }
  const call = value.toolCall;
  if (isRecord(call)) {
    const toolCall: HookToolCall = {};
    if (typeof call.name === "string") toolCall.name = call.name;
    if (isRecord(call.args)) toolCall.args = call.args;
    out.toolCall = toolCall;
  }
  const agent = value.agent;
  if (typeof agent === "string") out.agent = agent;
  else if (isRecord(agent)) {
    const nested: HookAgent = {};
    for (const key of AGENT_FIELDS) {
      const v = agent[key];
      if (typeof v === "string") nested[key] = v;
    }
    out.agent = nested;
  }
  return out;
}
