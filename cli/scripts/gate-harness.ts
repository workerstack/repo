/** What the gate knows of each harness: its wire shape, its tools, and how it takes a deny or a rewrite. */
import type { HookInput } from "./hook-input.ts";

/** Which wire shape a hook payload came in; Grok sends Claude's. */
export type Harness = "claude" | "codex" | "antigravity" | "cursor";

/** What one tool of one harness is to the gate, and which input fields carry its command and cwd. */
export interface ToolSpec {
  kind: "bash" | "write" | "read" | "grep" | "glob" | "patch";
  command?: string;
  cwd?: string;
  persistShared?: boolean;
  limits?: boolean;
}

/** A tool call's argument bag; the shape varies per harness and tool, so each field is checked where it is read. */
export type ToolArgs = Record<string, unknown>;

/** The gate's verdict on one call: a deny reason, a rewritten input, or null to let it through. */
export type GateResult = { type: "deny"; reason: string } | { type: "rewrite"; updatedInput: ToolArgs } | null;

/** The part of a hook payload the gate reads; a payload that failed parsing is null. */
export type Payload = HookInput | null | undefined;

/** What the gate prints for a deny or a rewrite; each harness reads its own subset of these fields. */
export interface HookOutput {
  decision?: string;
  reason?: string;
  permission?: string;
  user_message?: string;
  agent_message?: string;
  overwrite?: ToolArgs;
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: string;
    permissionDecisionReason?: string;
    updatedInput?: ToolArgs;
  };
}

const SHELL: ToolSpec = { command: "command", kind: "bash" };
// orchestrate-parent persists these itself, so the gate leaves their persist-owned redirects to it.
const SHARED_WRITE: ToolSpec = { kind: "write", persistShared: true };
const WRITE: ToolSpec = { kind: "write" };
// Cursor's Read and Grep take no offset, limit or head_limit, so the gate cannot inject or cap them.
const CURSOR_NO_LIMITS = { limits: false } as const;

const CLAUDE_TOOLS: readonly (readonly [string, ToolSpec])[] = [
  ["write", SHARED_WRITE],
  ["edit", SHARED_WRITE],
  ["searchreplace", SHARED_WRITE],
  ["bash", SHELL],
  ["runterminalcommand", SHELL],
  ["read", { kind: "read" }],
  ["readfile", { kind: "read" }],
  ["grep", { kind: "grep" }],
  ["glob", { kind: "glob" }],
  ["listdir", { kind: "glob" }],
];
const CODEX_TOOLS: readonly (readonly [string, ToolSpec])[] = [
  ["applypatch", { kind: "patch" }],
  ["bash", SHELL],
];
const CURSOR_TOOLS: readonly (readonly [string, ToolSpec])[] = [
  ["shell", { command: "command", cwd: "cwd", kind: "bash" }],
  ["read", { kind: "read", ...CURSOR_NO_LIMITS }],
  ["grep", { kind: "grep", ...CURSOR_NO_LIMITS }],
  ["write", SHARED_WRITE],
];
const ANTIGRAVITY_TOOLS: readonly (readonly [string, ToolSpec])[] = [
  ["writefile", WRITE],
  ["editfile", WRITE],
  ["runcommand", { command: "CommandLine", cwd: "Cwd", kind: "bash" }],
];

/**
 * The tools each harness sends, keyed by eventKey of the tool name. A harness only gets the kinds whose
 * fields it uses; anything else gets no answer. Claude also covers Grok, which sends the same shape.
 */
export const TOOLS: Readonly<Record<Harness, ReadonlyMap<string, ToolSpec>>> = {
  antigravity: /* @__PURE__ */ new Map(ANTIGRAVITY_TOOLS),
  claude: /* @__PURE__ */ new Map(CLAUDE_TOOLS),
  codex: /* @__PURE__ */ new Map(CODEX_TOOLS),
  cursor: /* @__PURE__ */ new Map(CURSOR_TOOLS),
};
export const WRITE_PATH_FIELDS: readonly string[] = [
  "path",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "Path",
];
export const SHELL_META: RegExp = /[|&;`$(){}<>\n\r]/;

export function eventKey(s: unknown): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** A payload object as the gate reads it; anything else (null, an array, a scalar) is not a hook call. */
export function isHookObject(v: unknown): v is HookInput {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** Which wire shape the hook payload came in. */
export function harnessOf(data: HookInput): Harness {
  // Cursor also sends model and session_id, so it is told apart by its version before Codex's check.
  if (typeof data.cursor_version === "string") return "cursor";
  if (isPlainObject(data.toolCall)) return "antigravity";
  // Codex sends both on every tool hook; Claude would read Codex's `allow` as skipping its permission prompt.
  if (typeof data.turn_id === "string" && typeof data.model === "string") return "codex";
  return "claude";
}

/** The call in one shape for every harness: its tool key and args (null when absent or not an object). */
export function toolCallOf(data: HookInput): { harness: Harness; key: string; args: ToolArgs | null } {
  const harness = harnessOf(data);
  const call = harness === "antigravity" ? data.toolCall : null;
  const name = call ? call.name : data.toolName || data.tool_name;
  let args: unknown = call ? call.args : data.toolInput;
  if (!call && args == null) args = data.tool_input;
  return { args: isPlainObject(args) ? args : null, harness, key: eventKey(name) };
}

/** Top-level "block" is the only legacy deny Claude/Codex validate; allow = empty stdout. */
function preToolUseDeny(reason: string): HookOutput {
  return {
    decision: "block",
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
    reason,
  };
}

/**
 * How each harness takes a deny and a rewrite. Codex drops `updatedInput` without `allow`, while Claude
 * reads `allow` as approve-without-prompt, so only Codex gets it. Antigravity merges `overwrite` into its args.
 * Cursor denies with its own top-level reply and takes Claude's nested `updatedInput` only while no top-level
 * field is set, so its rewrite carries no `permission`.
 */
interface Answers {
  deny: (reason: string) => HookOutput;
  rewrite: (args: ToolArgs | null, next: ToolArgs) => HookOutput;
}

const nestedRewrite = (_args: ToolArgs | null, next: ToolArgs): HookOutput => ({
  hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: next },
});
const ANSWERS: Record<Harness, Answers> = {
  antigravity: {
    deny: (reason: string) => ({ decision: "deny", reason }),
    rewrite: (args, next) => ({
      decision: "allow",
      overwrite: Object.fromEntries(Object.entries(next).filter(([k, v]) => !args || args[k] !== v)),
    }),
  },
  claude: {
    deny: preToolUseDeny,
    rewrite: nestedRewrite,
  },
  codex: {
    deny: preToolUseDeny,
    rewrite: (_args, next) => ({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: next },
    }),
  },
  cursor: {
    deny: (reason: string) => ({ agent_message: reason, permission: "deny", user_message: reason }),
    rewrite: nestedRewrite,
  },
};

export function answerDeny(data: HookInput, reason: string): HookOutput {
  return ANSWERS[harnessOf(data)].deny(reason);
}

export function answerRewrite(data: HookInput, next: ToolArgs): HookOutput {
  return ANSWERS[harnessOf(data)].rewrite(toolCallOf(data).args, next);
}

/** The hook answer for a gate result, in the shape the payload's harness takes. */
export function fatHookOutput(data: HookInput, result: GateResult): HookOutput | null {
  if (!result) return null;
  return result.type === "deny" ? answerDeny(data, result.reason) : answerRewrite(data, result.updatedInput);
}
