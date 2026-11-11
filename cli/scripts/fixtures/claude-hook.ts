import { orchestrateKit, replyOf, type HookOut } from "./orchestrate-kit.ts";

type Fields = Record<string, unknown>;

/** The parent hook run as Claude Code sends it from a workspace, its board in a temp home. */
export interface ClaudeHook {
  temp: (prefix?: string) => string;
  send: (ws: string, payload: Fields) => HookOut | null;
  stop: (ws: string, sid: string, extra: Fields) => HookOut | null;
}

/** Per test file: temp workspaces removed after each case, and a sender of any event or of a session's Stop. */
export function claudeHook(): ClaudeHook {
  const kit = orchestrateKit();
  function send(ws: string, payload: Fields): HookOut | null {
    return replyOf(kit.run({ cwd: ws, ...payload }, { CLAUDE_PROJECT_DIR: ws }));
  }
  return {
    send,
    stop: (ws, sid, extra) => send(ws, { hook_event_name: "Stop", session_id: sid, ...extra }),
    temp: kit.temp,
  };
}
