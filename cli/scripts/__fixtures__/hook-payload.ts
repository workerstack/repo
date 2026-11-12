// Typed hook payloads for the gate suites: one builder per wire shape, so a test never casts a literal.
import type { GateResult, HookOutput, ToolArgs } from "../gate-harness.ts";
import type { HookInput } from "../hook-input.ts";

/** The version string Cursor puts on every payload it sends. */
export const CURSOR_VERSION = "2026.11.05";

/** The seven wire shapes of a one-file write the gate has to read. */
export const WRITE_KINDS = [
  "claudeEdit",
  "claudeWrite",
  "codexTool",
  "codexHeredoc",
  "antigravity",
  "antigravityEdit",
  "cursor",
] as const;
export type WriteKind = (typeof WRITE_KINDS)[number];

/** Grok's camelCase shape: the tool name and input, plus any other fields of the payload. */
export function camelCall(tool: string, input: ToolArgs, extra: HookInput = {}): HookInput {
  return { toolName: tool, toolInput: input, ...extra };
}

/** Claude's snake_case shape. */
export function claudeCall(cwd: string, tool: string, input: ToolArgs): HookInput {
  return { cwd, tool_name: tool, tool_input: input };
}

/** Codex's shape: Claude's plus the turn and model it sends on every tool hook. */
export function codexCall(cwd: string, tool: string, input: ToolArgs): HookInput {
  return { turn_id: "t1", model: "m", cwd, tool_name: tool, tool_input: input };
}

/** Cursor's shape: Claude's plus the version that tells it apart. */
export function cursorCall(cwd: string, tool: string, input: ToolArgs): HookInput {
  return { cursor_version: CURSOR_VERSION, model: "m", cwd, tool_name: tool, tool_input: input };
}

/** Antigravity's shape: the call nested in `toolCall`, the workspace in a list. */
export function agyCall(root: string, name: string, args: ToolArgs): HookInput {
  return { conversationId: "c1", workspacePaths: [root], toolCall: { name, args } };
}

/** The payload in session `sid`, under the key its harness uses; null leaves the session out. */
export function inSession(payload: HookInput, sid: string | null): HookInput {
  const next: HookInput = { ...payload };
  delete next.session_id;
  delete next.conversationId;
  if (sid === null) return next;
  return payload.toolCall ? { ...next, conversationId: sid } : { ...next, session_id: sid };
}

/** The payload as a spawned child of type `type` sends it. */
export function asChild(payload: HookInput, type: string): HookInput {
  return { ...payload, agent_type: type };
}

/** A freeform patch that adds `file`. */
export function patchAdd(file: string): string {
  return `*** Begin Patch\n*** Add File: ${file}\n+hi\n*** End Patch`;
}

/** A patch that updates `file`. */
export function patchUpdate(file: string): string {
  return `*** Begin Patch\n*** Update File: ${file}\n@@\n-a\n+b\n*** End Patch`;
}

/** The shell form Codex also sends a patch in. */
export function heredoc(patch: string): string {
  return `apply_patch <<'EOF'\n${patch}\nEOF\n`;
}

/** What a write of `target` is: the cwd it runs in, and the content a Write or write_file carries. */
interface WriteSpec {
  cwd: string;
  target: string;
  content?: string;
}

const WRITERS: Record<WriteKind, (spec: Required<WriteSpec>) => HookInput> = {
  claudeEdit: (s) => claudeCall(s.cwd, "Edit", { file_path: s.target, old_string: "a", new_string: "b" }),
  claudeWrite: (s) => claudeCall(s.cwd, "Write", { file_path: s.target, content: s.content }),
  codexTool: (s) => codexCall(s.cwd, "apply_patch", { command: patchAdd(s.target) }),
  codexHeredoc: (s) => codexCall(s.cwd, "Bash", { command: heredoc(patchAdd(s.target)) }),
  antigravity: (s) => agyCall(s.cwd, "write_file", { Path: s.target, Content: s.content }),
  antigravityEdit: (s) => agyCall(s.cwd, "edit_file", { Path: s.target, Target: "a", Replacement: "b" }),
  cursor: (s) => cursorCall(s.cwd, "Write", { file_path: s.target, content: s.content }),
};

/** A write of `spec.target` in the wire shape of `kind`, with no session. */
export function kindWrite(kind: WriteKind, spec: WriteSpec): HookInput {
  return WRITERS[kind]({ cwd: spec.cwd, target: spec.target, content: spec.content ?? "x" });
}

/** The input a rewrite answer carries, `{}` for any other answer. */
export function updatedInputOf(out: GateResult): ToolArgs {
  return out?.type === "rewrite" ? out.updatedInput : {};
}

/** The reason a deny answer carries, "" for any other answer. */
export function denyReason(out: GateResult): string {
  return out?.type === "deny" ? out.reason : "";
}

/** Whether the answer lets the call through or rewrites it, rather than denying. */
export function notDenied(out: GateResult): boolean {
  return out?.type !== "deny";
}

/** The command a rewrite answer carries, "" for any other answer. */
export function commandOf(out: GateResult): string {
  const command = updatedInputOf(out).command;
  return typeof command === "string" ? command : "";
}

/** The input a Claude- or Codex-shaped reply carries, `{}` when it carries none. */
export function replyInput(out: HookOutput | null): ToolArgs {
  return out?.hookSpecificOutput?.updatedInput ?? {};
}

/** The command that reply carries, "" when it carries none. */
export function replyCommand(out: HookOutput | null): string {
  const command = replyInput(out).command;
  return typeof command === "string" ? command : "";
}

/** A hook's stdout as the reply it printed, null for silence. */
export function replyOf(stdout: string): HookOutput | null {
  return stdout ? (JSON.parse(stdout) /* the gate prints only HookOutput objects */ as HookOutput) : null;
}
