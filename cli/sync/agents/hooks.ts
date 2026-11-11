/**
 * The four hook files, from the merged `hooks.jsonc`: `.claude/settings.json`, `.codex/hooks.json`,
 * `.agents/hooks.json` and `.cursor/hooks.json`, in the shapes rulesync 43.7.0 wrote. Grok's hook configs are
 * static stock files. Each host sees the shared events it supports in source order, then its own override block
 * (`claudecode`, `codexcli`, `antigravity-cli`, `cursor`): a same event is replaced in place, new ones go last.
 * `D:<n>` cites a line of rulesync 43.7.0's bundled `dist/import-*.js`.
 */
import type { Host } from "../../config.ts";
import { expandHookCommand } from "../../scripts/hook-command.ts";
import type { Sources } from "./sources.ts";

type Json = Record<string, unknown>;
type Def = Json;
type Group = { matcher?: string; hooks: Json[] };

/** Canonical event to Claude event, D:6011-6044; also the events Claude supports. */
const CLAUDE_EVENTS: Record<string, string> = {
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
const CODEX_EVENTS: Record<string, string> = {
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
const ANTIGRAVITY_EVENTS: Record<string, string> = {
  postModelInvocation: "PostInvocation",
  postToolUse: "PostToolUse",
  preModelInvocation: "PreInvocation",
  preToolUse: "PreToolUse",
  sessionStart: "SessionStart",
  stop: "Stop",
};
/** D:6162-6184: cursor keeps the canonical names. */
const CURSOR_EVENTS = Object.fromEntries(
  [
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
  ].map((event) => [event, event]),
);
/** Whole matcher tokens Antigravity names differently, D:54345-54351. */
const ANTIGRAVITY_TOOLS: Record<string, string> = {
  Bash: "run_command",
  Edit: "(?:edit_file|replace_file_content)",
  Read: "(?:read_file|view_file)",
  WebSearch: "search_web",
  Write: "(?:write_file|write_to_file)",
};
/** A name token outside escapes and character classes, D:52398. */
const MATCHER_TOKEN = /\\.|\[(?:\\.|[^\]\\])*\]|(?<=^|[^\w\\]|\\\w)[A-Za-z_]\w*(?!\w)/gs;
const CURSOR_TYPES = new Set(["command", "prompt"]);
const CLAUDE_SCHEMA = "https://json.schemastore.org/claude-code-settings.json";

/** How one matcher-group host converts a definition (the converter configs at D:55604-55631, D:56372-56378, D:54389-54398). */
/**
 * One passthrough field (D:53298-53339): written when valid for its kind (D:53378-53385, `isStringArray` D:4415),
 * and only on command hooks when `commandOnly`. `onFailure` is claude's keyword field (D:55667-55678, D:53527-53572):
 * `failClosed: true` becomes `onFailure: "block"` on command and http hooks, except on the events claude ignores
 * it on and on command hooks that set `async` or `asyncRewake`.
 */
type Passthrough =
  | { key: string; kind: "boolean" | "number" | "string" | "array"; commandOnly?: true }
  | { key: "onFailure"; kind: "keyword" };

const VALID: Record<Exclude<Passthrough["kind"], "keyword">, (value: unknown) => boolean> = {
  array: (value) => Array.isArray(value) && value.every((item) => typeof item === "string"),
  boolean: (value) => typeof value === "boolean",
  number: (value) => Number.isFinite(value),
  string: (value) => typeof value === "string" && value !== "",
};
const ON_FAILURE_IGNORED = new Set(["stop", "subagentStop", "taskCompleted", "teammateIdle"]);

interface Target {
  overrideKey: string;
  names: Record<string, string>;
  /** Events whose groups carry no matcher; translation is skipped there too (D:53195, D:53796). */
  noMatcher: ReadonlySet<string>;
  /** Hook types written; others are skipped (D:53520, D:53681). */
  types: ReadonlySet<string>;
  command?: (command: string, def: Def) => string;
  /** Hook fields copied through, in the order rulesync writes them, ahead of `type` (D:53582-53640). */
  passthrough: readonly Passthrough[];
  matcher?: (matcher: string) => string;
  /** Whether prompt and agent hooks carry `model` (D:55632 `emitsPromptModel`). */
  promptModel: boolean;
  /** Whether `name` and `description` are written (codex `passthroughFields`, D:56378). */
  named: boolean;
}

const CLAUDE: Target = {
  overrideKey: "claudecode",
  names: CLAUDE_EVENTS,
  noMatcher: new Set([
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
  ]),
  types: new Set(["command", "prompt", "http", "mcp_tool", "agent"]),
  command: prefixProjectDir,
  // D:55633-55684, in emit order: booleans, keyword, strings, arrays.
  passthrough: [
    { key: "once", kind: "boolean" },
    { commandOnly: true, key: "async", kind: "boolean" },
    { commandOnly: true, key: "asyncRewake", kind: "boolean" },
    { key: "continueOnBlock", kind: "boolean" },
    { key: "onFailure", kind: "keyword" },
    { key: "if", kind: "string" },
    { key: "statusMessage", kind: "string" },
    { commandOnly: true, key: "shell", kind: "string" },
    { commandOnly: true, key: "args", kind: "array" },
  ],
  promptModel: true,
  named: false,
};
const CODEX: Target = {
  overrideKey: "codexcli",
  names: CODEX_EVENTS,
  noMatcher: new Set(),
  types: new Set(["command", "mcp_tool"]),
  // D:56377-56394, in emit order: booleans, numbers, strings.
  passthrough: [
    { commandOnly: true, key: "async", kind: "boolean" },
    { commandOnly: true, key: "additionalContextLimit", kind: "number" },
    { commandOnly: true, key: "commandWindows", kind: "string" },
    { key: "statusMessage", kind: "string" },
  ],
  promptModel: false,
  named: true,
};
/** D:54322-54327; these events are also written as bare handler lists (D:54405-54410). */
const ANTIGRAVITY_NO_MATCHER = new Set(["sessionStart", "preModelInvocation", "postModelInvocation", "stop"]);
const ANTIGRAVITY_FLAT = new Set([...ANTIGRAVITY_NO_MATCHER].map((event) => ANTIGRAVITY_EVENTS[event]));
const ANTIGRAVITY: Target = {
  matcher: (matcher) =>
    matcher.replace(MATCHER_TOKEN, (token) =>
      Object.hasOwn(ANTIGRAVITY_TOOLS, token) ? ANTIGRAVITY_TOOLS[token]! : token,
    ),
  named: false,
  names: ANTIGRAVITY_EVENTS,
  noMatcher: ANTIGRAVITY_NO_MATCHER,
  overrideKey: "antigravity-cli",
  passthrough: [],
  promptModel: false,
  types: new Set(["command"]),
};

/** Path to text for each enabled host's hook file; `claudeBase` is the stock `agents/settings/claude.json`. */
export function renderHooks(sources: Sources, hosts: readonly Host[], claudeBase: string): Map<string, string> {
  const config = sources.hooks.value;
  const files = new Map<string, string>();
  if (hosts.includes("claude")) {
    files.set(".claude/settings.json", text(claudeSettings(claudeBase, toolHooks(config, CLAUDE))));
  }
  if (hosts.includes("codex"))
    files.set(".codex/hooks.json", text({ hooks: filterCodexHandlers(toolHooks(config, CODEX)) }));
  if (hosts.includes("antigravity")) {
    const flat = Object.entries(toolHooks(config, ANTIGRAVITY)).map(([event, groups]) => [
      event,
      ANTIGRAVITY_FLAT.has(event) ? groups.flatMap((group) => group.hooks) : groups,
    ]);
    files.set(".agents/hooks.json", text(flat.length === 0 ? {} : { rulesync: Object.fromEntries(flat) }));
  }
  if (hosts.includes("cursor"))
    files.set(".cursor/hooks.json", text({ hooks: cursorHooks(config), version: config.version ?? 1 }));
  return files;
}

function text(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The host's name for an event; an override event it has none for keeps its own (`lookupOwn … ?? eventName`, D:53765-53768). */
function nameOf(names: Record<string, string>, event: string): string {
  return Object.hasOwn(names, event) ? names[event]! : event;
}

/** Shared events the host names, in source order, then `{...shared, ...override}`; overrides are unfiltered (D:53170-53178). */
function effectiveEvents(config: Json, overrideKey: string, names: Record<string, string>): [string, Def[]][] {
  const shared = Object.entries((config.hooks as Record<string, Def[]> | undefined) ?? {}).filter(([event]) =>
    Object.hasOwn(names, event),
  );
  const override = (config[overrideKey] as { hooks?: Record<string, Def[]> } | undefined)?.hooks ?? {};
  return Object.entries({ ...Object.fromEntries(shared), ...override });
}

/**
 * Per event, defs grouped by (translated) matcher in first-appearance order (D:53186-53215): `{matcher, hooks}`,
 * or `{hooks}` when the matcher is empty or the event takes none. Groups left without a writable hook, and events
 * left without a group, are dropped (D:53756-53800).
 */
function toolHooks(config: Json, target: Target): Record<string, Group[]> {
  const out: Record<string, Group[]> = {};
  for (const [event, defs] of effectiveEvents(config, target.overrideKey, target.names)) {
    const noMatcher = target.noMatcher.has(event);
    const groups = new Map<string, Def[]>();
    for (const def of defs) {
      const raw = (def.matcher as string | undefined) ?? "";
      const matcher = raw === "" || noMatcher || target.matcher === undefined ? raw : target.matcher(raw);
      groups.set(matcher, [...(groups.get(matcher) ?? []), def]);
    }
    const entries: Group[] = [];
    for (const [matcher, group] of groups) {
      const hooks = group
        .filter((def) => target.types.has((def.type as string | undefined) ?? "command"))
        .map((def) => hookObject(def, event, target));
      if (hooks.length === 0) continue;
      entries.push(matcher === "" || noMatcher ? { hooks } : { hooks, matcher });
    }
    if (entries.length > 0) out[nameOf(target.names, event)] = entries;
  }
  return out;
}

/**
 * Passthrough fields, `type`, `command`, `timeout`, `prompt`, the type's payload, then codex's `name`/`description`
 * (D:53698-53735, D:53598-53612).
 */
function hookObject(def: Def, event: string, target: Target): Json {
  const type = (def.type as string | undefined) ?? "command";
  const source = typeof def.command === "string" ? expandHookCommand(def.command) : def.command;
  const command = typeof source === "string" && target.command !== undefined ? target.command(source, def) : source;
  const payload: Record<string, readonly string[]> = {
    agent: target.promptModel ? ["model"] : [],
    http: ["url", "headers", "allowedEnvVars"],
    mcp_tool: ["server", "tool", "input"],
    prompt: target.promptModel ? ["model"] : [],
  };
  const fields = {
    ...passthroughFields(def, type, event, target),
    command,
    prompt: def.prompt,
    timeout: def.timeout,
    type,
  } as Json;
  for (const key of [...(payload[type] ?? []), ...(target.named ? ["name", "description"] : [])])
    fields[key] = def[key];
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null));
}

function passthroughFields(def: Def, type: string, event: string, target: Target): Json {
  const out: Json = {};
  for (const field of target.passthrough) {
    if (field.kind === "keyword") {
      const blocked = type === "command" && (def.async === true || def.asyncRewake === true);
      const applies = (type === "command" || type === "http") && !ON_FAILURE_IGNORED.has(event) && !blocked;
      if (def.failClosed === true && applies) out.onFailure = "block";
    } else if (VALID[field.kind](def[field.key]) && (field.commandOnly !== true || type === "command")) {
      out[field.key] = def[field.key];
    }
  }
  return out;
}

/**
 * Deliberate divergence from rulesync: only a leading `./` (optionally quoted) gets the project dir; script
 * operands later in the command are left alone. A shell command gets `"$CLAUDE_PROJECT_DIR"/`; an exec-form
 * hook (`args` is an array) gets `${CLAUDE_PROJECT_DIR}/` with the surrounding quotes stripped (D:53245-53266).
 */
function prefixProjectDir(command: string, def: Def): string {
  const lead = /^(['"]?)\.\/(.*)$/s.exec(command);
  if (lead === null) return command;
  const relative = `${lead[1]}${lead[2]}`;
  if (!Array.isArray(def.args)) return `"$CLAUDE_PROJECT_DIR"/${relative}`;
  return `\${CLAUDE_PROJECT_DIR}/${relative.replace(/^(["'])(.*)\1$/, "$2").replace(/^["']/, "")}`;
}

/** Why Codex would refuse a handler, or undefined (`describeRejectedHandler`, D:56419-56429). */
function codexRejects(hook: Json): boolean {
  const { timeout } = hook;
  if (timeout !== undefined && !(Number.isSafeInteger(timeout) && (timeout as number) >= 0)) return true;
  if (hook.type !== "mcp_tool") return false;
  return (
    [hook.server, hook.tool].some((value) => typeof value !== "string" || value === "") || containsNull(hook.input)
  );
}

function containsNull(value: unknown): boolean {
  if (value === null) return true;
  return typeof value === "object" && Object.values(value).some(containsNull);
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
  const settings: Json = { ...(JSON.parse(base) as Json), hooks };
  return "$schema" in settings ? settings : { $schema: CLAUDE_SCHEMA, ...settings };
}

/**
 * Cursor's flat entries, no grouping (D:57912-57936): command and prompt handlers only, `type` only when the
 * source has one, `model` only on prompt handlers; events left empty are dropped.
 */
function cursorHooks(config: Json): Json {
  const out: Json = {};
  for (const [event, defs] of effectiveEvents(config, "cursor", CURSOR_EVENTS)) {
    const mapped = defs
      .filter((def) => CURSOR_TYPES.has((def.type as string | undefined) ?? "command"))
      .map((def) => {
        const { type, command, timeout, loop_limit, matcher, prompt, model, failClosed } = def;
        const entry = {
          command: typeof command === "string" ? expandHookCommand(command) : command,
          failClosed,
          loop_limit,
          matcher,
          model: type === "prompt" ? model : undefined,
          prompt,
          timeout,
          type,
        };
        // `loop_limit` alone is written when null.
        return Object.fromEntries(
          Object.entries(entry).filter(
            ([key, value]) => value !== undefined && (value !== null || key === "loop_limit"),
          ),
        );
      });
    if (mapped.length > 0) out[nameOf(CURSOR_EVENTS, event)] = mapped;
  }
  return out;
}
