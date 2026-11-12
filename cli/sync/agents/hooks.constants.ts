/** `D:<n>` cites a line of rulesync 43.7.0's bundled `dist/import-*.js`. */

/** Canonical event to Claude event, D:6011-6044; also the events Claude supports. */
export const CLAUDE_EVENTS: Readonly<Record<string, string>> = {
  beforeSubmitPrompt: "UserPromptSubmit",
  configChange: "ConfigChange",
  cwdChanged: "CwdChanged",
  directoryAdded: "DirectoryAdded",
  elicitation: "Elicitation",
  elicitationResult: "ElicitationResult",
  fileChanged: "FileChanged",
  instructionsLoaded: "InstructionsLoaded",
  messageDisplay: "MessageDisplay",
  notification: "Notification",
  permissionDenied: "PermissionDenied",
  permissionRequest: "PermissionRequest",
  postCompact: "PostCompact",
  postModelSwitch: "PostModelSwitch",
  postToolBatch: "PostToolBatch",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
  preCompact: "PreCompact",
  preModelSwitch: "PreModelSwitch",
  preToolUse: "PreToolUse",
  sessionEnd: "SessionEnd",
  sessionStart: "SessionStart",
  setup: "Setup",
  stop: "Stop",
  stopFailure: "StopFailure",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
  taskCompleted: "TaskCompleted",
  taskCreated: "TaskCreated",
  teammateIdle: "TeammateIdle",
  userPromptExpansion: "UserPromptExpansion",
  worktreeCreate: "WorktreeCreate",
  worktreeRemove: "WorktreeRemove",
};

/** D:6525-6540. */
export const CODEX_EVENTS: Readonly<Record<string, string>> = {
  beforeSubmitPrompt: "UserPromptSubmit",
  permissionRequest: "PermissionRequest",
  postCompact: "PostCompact",
  postModelInvocation: "PostModelRequest",
  postToolUse: "PostToolUse",
  preCompact: "PreCompact",
  preModelInvocation: "PreModelRequest",
  preToolUse: "PreToolUse",
  sessionEnd: "SessionEnd",
  sessionStart: "SessionStart",
  stop: "Stop",
  stopCancelled: "Interrupt",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
};

/** D:6135-6142. */
export const ANTIGRAVITY_EVENTS: Readonly<Record<string, string>> = {
  postModelInvocation: "PostInvocation",
  postToolUse: "PostToolUse",
  preModelInvocation: "PreInvocation",
  preToolUse: "PreToolUse",
  sessionStart: "SessionStart",
  stop: "Stop",
};

/** D:6162-6184: the events cursor supports, in its order. */
const CURSOR_EVENT_NAMES: readonly string[] = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "beforeSubmitPrompt",
  "stop",
  "subagentStop",
  "preCompact",
  "postToolUseFailure",
  "subagentStart",
  "beforeShellExecution",
  "afterShellExecution",
  "beforeMCPExecution",
  "afterMCPExecution",
  "beforeReadFile",
  "afterFileEdit",
  "afterAgentResponse",
  "afterAgentThought",
  "beforeTabFileRead",
  "afterTabFileEdit",
  "workspaceOpen",
];

/** Cursor keeps the canonical names. */
export const CURSOR_EVENTS: Readonly<Record<string, string>> = /* @__PURE__ */ Object.fromEntries(
  /* @__PURE__ */ CURSOR_EVENT_NAMES.map((event) => [event, event]),
);

/** Whole matcher tokens Antigravity names differently, D:54345-54351. */
export const ANTIGRAVITY_TOOLS: Readonly<Record<string, string>> = {
  Bash: "run_command",
  Edit: "(?:edit_file|replace_file_content)",
  Read: "(?:read_file|view_file)",
  WebSearch: "search_web",
  Write: "(?:write_file|write_to_file)",
};

/** A name token outside escapes and character classes, D:52398. */
export const MATCHER_TOKEN: RegExp = /\\.|\[(?:\\.|[^\]\\])*\]|(?<=^|[^\w\\]|\\\w)[A-Za-z_]\w*(?!\w)/gs;

/** A command that starts with `./`, optionally quoted: the quote, then the rest after `./`. */
export const LEADING_DOT_SLASH: RegExp = /^(?<quote>['"]?)\.\/(?<rest>.*)$/s;

/** A path wrapped whole in one kind of quote. */
export const WRAPPED_IN_QUOTES: RegExp = /^(?<quote>["'])(?<inner>.*)\k<quote>$/;

/** A leading quote left over from a half-quoted path. */
export const LEADING_QUOTE: RegExp = /^["']/;

/** The handler kinds a definition's `type` names; a definition without one is a command. */
export const COMMAND = "command";
export const HTTP = "http";
export const MCP_TOOL = "mcp_tool";
export const PROMPT = "prompt";
export const AGENT = "agent";

/** Cursor's loop limit field, written even when null. */
export const LOOP_LIMIT = "loop_limit";

/** The payload field only some targets emit. */
export const MODEL = "model";

/** The indent of every written hook file. */
export const JSON_INDENT = 2;

/** The keyword claude writes for `failClosed: true`. */
export const BLOCK = "block";

/** The version cursor's hook file gets when the source names none. */
export const CURSOR_VERSION = 1;

/** The hook file each host reads. */
export const CLAUDE_FILE = ".claude/settings.json";
export const CODEX_FILE = ".codex/hooks.json";
export const ANTIGRAVITY_FILE = ".agents/hooks.json";
export const CURSOR_FILE = ".cursor/hooks.json";

/** The override block of each host in hooks.jsonc. */
export const CLAUDE_KEY = "claudecode";
export const CODEX_KEY = "codexcli";
export const ANTIGRAVITY_KEY = "antigravity-cli";
export const CURSOR_KEY = "cursor";

export const CURSOR_TYPES: ReadonlySet<string> = /* @__PURE__ */ new Set([COMMAND, PROMPT]);
export const CLAUDE_SCHEMA = "https://json.schemastore.org/claude-code-settings.json";

/** The events claude ignores `onFailure` on. */
export const ON_FAILURE_IGNORED: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "stop",
  "subagentStop",
  "taskCompleted",
  "teammateIdle",
]);

/** D:54322-54327; these events are also written as bare handler lists (D:54405-54410), under their host names. */
export const ANTIGRAVITY_NO_MATCHER: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "sessionStart",
  "preModelInvocation",
  "postModelInvocation",
  "stop",
]);

export const ANTIGRAVITY_FLAT: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "SessionStart",
  "PreInvocation",
  "PostInvocation",
  "Stop",
]);

/** Claude's events whose groups carry no matcher. */
export const CLAUDE_NO_MATCHER: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "worktreeCreate",
  "worktreeRemove",
  "messageDisplay",
  "postToolBatch",
  "taskCreated",
  "taskCompleted",
  "teammateIdle",
  "cwdChanged",
  "beforeSubmitPrompt",
  "stop",
]);
