/** The replies the parent hook's handlers return, and the write target they answer about. */
import { isString } from "../json.ts";
import { answerDeny, answerRewrite, type ToolArgs, WRITE_PATH_FIELDS } from "./gate-harness.ts";
import type { HookInput } from "./hook-input.ts";
import type { HookResult, HostReply } from "./orchestrate.types.ts";

/** No reply: the host goes on as it would without the hook. */
export const PASS: Readonly<HookResult> = { code: 0 };

export function replyWith(reply: HostReply): HookResult {
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
export function writeTarget(toolInput: ToolArgs): string {
  for (const key of ["file_path", "filePath", "path", "target_file"]) {
    const v = toolInput[key];

    if (isString(v) && v !== "") return v;
  }

  return "";
}

/** The full content a Write sent; "" for an Edit. */
export function contentOf(toolInput: ToolArgs): string {
  return isString(toolInput.content) ? toolInput.content : "";
}

// Hosts name the target differently; point every key the host sent at the absolute file.
function withPath(toolInput: ToolArgs, abs: string): ToolArgs {
  const next: ToolArgs = Object.assign({}, toolInput);
  const keys: string[] = WRITE_PATH_FIELDS.filter((key) => isString(next[key]) && next[key] !== "");

  for (const key of keys) next[key] = abs;

  return next;
}

/** The write rewritten to land `file.content` at `file.abs`. */
export function savedReply(data: HookInput, toolInput: ToolArgs, file: { abs: string; content: string }): HookResult {
  return replyWith(answerRewrite(data, Object.assign(withPath(toolInput, file.abs), { content: file.content })));
}
