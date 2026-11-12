import { isRecord } from "../json.ts";
/** The board's hook side: a row from a hook payload, and the other sessions' lines for this one. */
import { repoEnv, type Env } from "../repo-env.ts";
import { boardHome } from "./board-files.ts";
import { isTruthy, str, valueOrNone } from "./board-line.ts";
import { bootOr, hostIdentity, probeProcess } from "./board-process.ts";
import { DEFAULT_SESSION, NONE } from "./board.constants.ts";
import { digest, note } from "./board.ts";
import type { BoardInput, BoardRow, Probe, RecordDeps } from "./board.types.ts";

type Data = BoardInput | null | undefined;

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function firstTruthy(values: unknown[]): unknown {
  return values.find(isTruthy);
}

function providerOf(data: Data, env: Env): string {
  if (isSet(env.REPO_BOARD_PROVIDER)) return env.REPO_BOARD_PROVIDER;

  if (firstTruthy([env.GROK_WORKSPACE_ROOT, env.GROK_SESSION_ID, env.GROK_HOOK_EVENT]) !== undefined) return "grok";

  if (isSet(env.CLAUDE_PROJECT_DIR)) return "claude";

  return isTruthy(data?.model) ? "codex" : NONE;
}

function effortOf(data: Data, env: Env): string {
  const effort = data?.effort;
  const level = isRecord(effort) ? effort.level : effort;
  const text = str(level);

  if (text.trim() !== "") return text;
  const fromEnv = env.CLAUDE_EFFORT ?? "";

  return fromEnv.trim() === "" ? NONE : fromEnv;
}

function sessionOf(data: Data, env: Env): string {
  return str(firstTruthy([data?.session_id, data?.sessionId, env.GROK_SESSION_ID])).trim();
}

function cwdOf(data: Data, env: Env): unknown {
  const roots = [env.GROK_WORKSPACE_ROOT, data?.workspaceRoot, data?.workspace_root, data?.cwd, env.CLAUDE_PROJECT_DIR];

  return firstTruthy(roots) ?? process.cwd();
}

function promptOf(data: Data): string {
  return str(data?.prompt ?? data?.userPrompt ?? data?.user_prompt);
}

/** Writes the row a hook payload describes; null when there is no session, no host process, or any error. */
export function recordHook(data: Data, env: Env = repoEnv.process, deps: RecordDeps = {}): BoardRow | null {
  try {
    const session = sessionOf(data, env);

    if (session === "" || session === DEFAULT_SESSION) return null;
    const ident = deps.identity ?? hostIdentity({ probe: deps.probe ?? probeProcess });

    if (ident === null) return null;

    return note({
      boot: bootOr(deps.boot),
      cwd: cwdOf(data, env),
      effort: effortOf(data, env),
      env,
      home: boardHome(env),
      model: valueOrNone(data?.model),
      now: deps.now,
      pid: ident.pid,
      probe: deps.probe,
      provider: providerOf(data, env),
      session,
      start: ident.start,
      work: promptOf(data),
    });
  } catch {
    return null;
  }
}

/** The digest of every session but this one; "" on any error. */
export function otherLines(
  data: Data,
  env: Env = repoEnv.process,
  deps: { boot?: string | undefined; probe?: Probe | undefined } = {},
): string {
  try {
    return digest({
      boot: bootOr(deps.boot),
      env,
      home: boardHome(env),
      probe: deps.probe,
      provider: providerOf(data, env),
      session: sessionOf(data, env),
    });
  } catch {
    return "";
  }
}
