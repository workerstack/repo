#!/usr/bin/env bun
/** PreToolUse: fat Read/Grep/Glob/Bash gate. Fail-open: parse/crash → empty stdout, exit 0. */
import { PATCH_FIELD, SCOUT_TYPES, GITIGNORE, WORKTREE_WORD } from "./gate.constants.ts";
import { isParentOrchestrator, sessionIdOf, subagentTypeOf } from "./gate-agents.ts";
import type { GateCall, GuardResult } from "./gate-call.ts";
import {
  TOOLS,
  WRITE_PATH_FIELDS,
  fatHookOutput,
  isHookObject,
  toolCallOf,
  type GateResult,
  type HookOutput,
  type Payload,
  type ToolArgs,
  type ToolSpec,
} from "./gate-harness.ts";
import { limitsGuard, pathGuard } from "./gate-limits.ts";
import { patchGuard, patchOfCommand, writeGuard } from "./gate-rewrites.ts";
import { reviewGuard, sharedCheckoutGuard } from "./gate-review.ts";
import { denylistShellGuard, dumpGuard, jobScriptGuard, testRunGuard, treeGuard, webGuard } from "./gate-shell.ts";
import { patchIgnoreEdits, redundantIgnoreReason, shellIgnoreEdits, writeIgnoreEdits } from "./gitignore-guard.ts";
import type { HookInput } from "./hook-input.ts";
import { processHookIo, readHookInput, type HookIo } from "./hook-io.ts";
import { resolveRoots, resolveTyped, type Roots } from "./workspace-root.ts";
import { worktreeAddReason } from "./worktree-guards.ts";

/** The input field that holds the command; a Codex patch is a write, whether sent as apply_patch or a shell heredoc. */
function fieldOf(tool: ToolSpec): string {
  return tool.kind === "patch" ? PATCH_FIELD : (tool.command ?? "");
}

/** The patch a call carries: the whole command of the patch tool, or the heredoc of a shell command. */
function patchOf(kind: ToolSpec["kind"], text: string): string | null {
  if (kind === "patch") return text;
  return kind === "bash" ? patchOfCommand(text) : null;
}

/** Where a shell command runs: the cwd its tool names, else the hook's. */
function shellCwdOf(tool: ToolSpec, input: ToolArgs, roots: Roots): string {
  const typed = tool.cwd ? input[tool.cwd] : undefined;
  return typeof typed === "string" ? resolveTyped(roots, typed) : roots.cwd;
}

/** The call in the one shape every guard reads, or null when the tool is not one the harness's gate handles. */
function callOf(data: HookInput): GateCall | null {
  const { harness, key, args: input } = toolCallOf(data);
  const tool = TOOLS[harness].get(key);
  if (!tool || !input) return null;
  const roots = resolveRoots(data);
  const field = fieldOf(tool);
  const typed = field ? input[field] : undefined;
  const text = typeof typed === "string" ? typed : "";
  const shellCwd = shellCwdOf(tool, input, roots);
  const sub = subagentTypeOf(data);
  const patch = patchOf(tool.kind, text);
  const parent = isParentOrchestrator(data);
  return { data, harness, tool, input, roots, sid: sessionIdOf(data), field, text, patch, shellCwd, sub, parent };
}

/** The ignore edits a call makes: a write's content, a patch's headers, or a shell command that touches `.gitignore`. */
function ignoreEditsOf(call: GateCall): ReturnType<typeof writeIgnoreEdits> {
  const { tool, input, roots, patch, text, shellCwd } = call;
  if (tool.kind === "write") return writeIgnoreEdits(input, roots.cwd, WRITE_PATH_FIELDS);
  if (patch) return patchIgnoreEdits(patch, shellCwd);
  return tool.kind === "bash" && text.includes(GITIGNORE) ? shellIgnoreEdits(text, shellCwd) : [];
}

/** Ahead of every early return, so scout subagents are held to it too. */
function ignoreGuard(call: GateCall): GuardResult {
  const reason = redundantIgnoreReason(ignoreEditsOf(call));
  return reason ? { type: "deny", reason } : undefined;
}

function strayWorktreeGuard({ tool, text, roots, shellCwd }: GateCall): GuardResult {
  const reason =
    tool.kind === "bash" && text.includes(WORKTREE_WORD) ? worktreeAddReason(text, { roots, cwd: shellCwd }) : null;
  return reason ? { type: "deny", reason } : undefined;
}

/** A patch tool whose command holds no patch has nothing to answer. */
function emptyPatchGuard({ tool }: GateCall): GuardResult {
  return tool.kind === "patch" ? null : undefined;
}

/** Scouts and researchers read freely; only the guards above hold them. */
function scoutGuard({ sub }: GateCall): GuardResult {
  return SCOUT_TYPES.includes(sub) ? null : undefined;
}

export type Guard = (call: GateCall) => GuardResult;

/**
 * The guard steps in order. `undefined` passes the call to the next step, `null` stops with no answer and an
 * object is the answer. The ignore and worktree guards come first, so no early return skips them.
 */
const GUARDS: readonly Guard[] = [
  ignoreGuard,
  strayWorktreeGuard,
  sharedCheckoutGuard,
  reviewGuard,
  writeGuard,
  patchGuard,
  emptyPatchGuard,
  scoutGuard,
  pathGuard,
  limitsGuard,
  // Every other kind has answered above, so what is left is a shell call.
  denylistShellGuard,
  jobScriptGuard,
  testRunGuard,
  webGuard,
  dumpGuard,
  treeGuard,
];

export function processFatTools(data: Payload): GateResult {
  if (!isHookObject(data)) return null;
  const call = callOf(data);
  if (!call) return null;
  for (const guard of GUARDS) {
    const answer = guard(call);
    if (answer !== undefined) return answer;
  }
  return null;
}

export function processHookPayload(data: Payload): HookOutput | null {
  const result = processFatTools(data);
  return data && result ? fatHookOutput(data, result) : null;
}

export function main(_argv: string[] = [], io: HookIo = processHookIo()): number {
  try {
    const data = readHookInput(io);
    const out = processHookPayload(data);
    if (!out) return 0;
    io.write(JSON.stringify(out));
    return 0;
  } catch {
    return 0;
  }
}
