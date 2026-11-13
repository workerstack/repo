// One session's events, sent in Claude's snake_case or Grok's camelCase shape, for the orchestrate-parent suites.
import fs from "node:fs";
import { replyOf, type HookOut, type OrchestrateKit } from "./orchestrate-kit.ts";

/** The two payload shapes a session's events are sent in. */
export type Casing = "claude" | "grok";
type Env = Record<string, string | undefined>;
/** The fields one event carries; each lands in the shape's own key. */
export type Fields = { prompt?: string; msg?: string; tool?: string; input?: Record<string, unknown>; tp?: string };
/** The workspace, session, shape and env every event of the session is sent with. */
export type SessionAt = { ws: string; sid: string; casing: Casing; env?: Env };

export interface HookSession {
  call: (event: string, f?: Fields) => HookOut | null;
  /** The context a prompt gets; "" when the hook stays silent. */
  say: (text: string, tp?: string) => string;
  stop: (msg: string) => HookOut | null;
  /** A Write sent through the hook and landed as the host would; returns the saved path. */
  save: (file: string, content: string) => string;
  /** A new save, then the review-bump re-save, as /write-plan does it. */
  reviewed: (dir: "plans" | "roadmaps", body: string) => string;
  spawnReview: (text: string) => HookOut | null;
}

function payloadOf(at: SessionAt, event: string, f: Fields): object {
  if (at.casing === "claude")
    return {
      cwd: at.ws,
      hook_event_name: event,
      session_id: at.sid,
      prompt: f.prompt,
      last_assistant_message: f.msg,
      tool_name: f.tool,
      tool_input: f.input,
      transcript_path: f.tp,
    };
  return {
    workspaceRoot: at.ws,
    hookEventName: event,
    sessionId: at.sid,
    reason: "end_turn",
    prompt: f.prompt,
    lastAssistantMessage: f.msg,
    toolName: f.tool?.toLowerCase(),
    toolInput: f.input,
    transcriptPath: f.tp,
  };
}

export function hookSession(kit: OrchestrateKit, at: SessionAt): HookSession {
  const claude = at.casing === "claude";
  const call = (event: string, f: Fields = {}): HookOut | null => replyOf(kit.run(payloadOf(at, event, f), at.env));
  const save = (file: string, content: string): string => {
    const input = claude ? { file_path: file, content } : { path: file, content };
    const updated = call("PreToolUse", { tool: "Write", input })?.hookSpecificOutput.updatedInput;
    const saved = claude ? updated?.file_path : updated?.path;
    if (!updated || !saved) throw new Error(`no rewrite for ${file}`);
    fs.writeFileSync(saved, updated.content);
    return saved;
  };
  return {
    call,
    say: (text, tp) => call("UserPromptSubmit", { prompt: text, tp })?.hookSpecificOutput.additionalContext ?? "",
    stop: (msg) => call("Stop", { msg }),
    save,
    reviewed: (dir, body) => {
      const saved = save(`.repo/${dir}/x.md`, body);
      save(saved, fs.readFileSync(saved, "utf8").replace("reviews: 0", "reviews: 1"));
      return saved;
    },
    spawnReview: (text) =>
      call("PreToolUse", {
        tool: claude ? "Agent" : "Task",
        input: { description: "review", subagent_type: "reviewer", prompt: text },
      }),
  };
}
