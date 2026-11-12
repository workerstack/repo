/** The replies the parent hook's handlers return, and the write target they answer about. */
import { answerDeny, answerRewrite, WRITE_PATH_FIELDS } from "./gate-harness.ts";
import type { HookInput } from "./hook-input.ts";
import type { HookResult, ToolInput } from "./orchestrate.types.ts";

/** No reply: the host goes on as it would without the hook. */
export const PASS: Readonly<HookResult> = { code: 0 };

export function replyWith(reply: object): HookResult {
  return { code: 0, reply };
}

/** A stop or subagent stop blocked with a reason the agent reads. */
export function blockWith(reason: string): HookResult {
  return replyWith({ decision: "block", reason });
}

export function denyWith(data: HookInput, reason: string): HookResult {
  return replyWith(answerDeny(data, reason));
}

/** The path the host named, in whichever field it used; "" when none. */
export function writeTarget(toolInput: ToolInput): string {
  for (const key of ["file_path", "filePath", "path", "target_file"]) {
    const v = toolInput[key];

    if (typeof v === "string" && v !== "") return v;
  }

  return "";
}

/** The full content a Write sent; "" for an Edit. */
export function contentOf(toolInput: ToolInput): string {
  return typeof toolInput.content === "string" ? toolInput.content : "";
}

// Hosts name the target differently; point every key the host sent at the absolute file.
function withPath(toolInput: ToolInput, abs: string): ToolInput {
  const next: ToolInput = Object.assign({}, toolInput);
  const keys: string[] = WRITE_PATH_FIELDS.filter((key) => typeof next[key] === "string" && next[key] !== "");

  for (const key of keys) next[key] = abs;

  return next;
}

/** The write rewritten to land `file.content` at `file.abs`. */
export function savedReply(data: HookInput, toolInput: ToolInput, file: { abs: string; content: string }): HookResult {
  return replyWith(answerRewrite(data, Object.assign(withPath(toolInput, file.abs), { content: file.content })));
}
