/** The hosts suite's helpers: the hook commands a host's files hold, and those hooks run the way the host runs them. */
import path from "node:path";

import { expect } from "vitest";

import { isRecord } from "./json";
import type { Run } from "./run.types";
import type { Sandbox } from "./sandbox";
import { BROKEN_RUNTIME } from "./sandbox.constants";
import { tail } from "./tail";

export const ROOT_VARS = { CLAUDE_PROJECT_DIR: undefined, GROK_WORKSPACE_ROOT: undefined };
export const GATE = " hook gate-fat-tools";
export const MAP = " hook session-map";

type Handler = { type?: string; command?: string };

type Group = { matcher?: string; hooks?: Handler[] };

/** Which command hooks to pick: those of `event` whose command ends with `ends`. */
type HookPick = { event: string; ends: string };

/** How a hook runs: its stdin payload, and the cwd and env the host gives it. */
type HookRun = { payload: unknown; cwd?: string; env?: NodeJS.ProcessEnv };

export function expectClean(sb: Sandbox, r: Run) {
  expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
  sb.expectOk(r);
}

/** The hook groups of `event` in a host's hook file, in file order. */
function groupsOf(sb: Sandbox, file: string, event: string): Group[] {
  const doc: unknown = JSON.parse(sb.read(file));
  const hooks = isRecord(doc) && isRecord(doc.hooks) ? doc.hooks[event] : undefined;

  return Array.isArray(hooks) ? (hooks /* a host's hook file lists matcher groups per event */ as Group[]) : [];
}

/** The command hooks of `pick.event` in a host's hook file, in file order; `pick.ends` keeps those of one repo hook. */
export function commands(sb: Sandbox, file: string, pick: HookPick): string[] {
  return groupsOf(sb, file, pick.event)
    .flatMap((g) => g.hooks ?? [])
    .flatMap((h) =>
      h.type === "command" && h.command !== undefined && h.command.endsWith(pick.ends) ? [h.command] : [],
    );
}

/** Every Stop hook command in a host's hook file, in file order. */
export function stopCommands(sb: Sandbox, file: string): string[] {
  return groupsOf(sb, file, "Stop")
    .flatMap((g) => g.hooks ?? [])
    .flatMap((h) => (h.command === undefined || h.command === "" ? [] : [h.command]));
}

export function only(list: string[], what: string): string {
  expect(list, what).toHaveLength(1);
  const [first] = list;

  if (first === undefined) throw new Error(`no ${what}`);

  return first;
}

/** Runs a hook command the way a host does, from `cwd`, with the payload on stdin. */
export function runHook(sb: Sandbox, command: string, { payload, cwd, env }: HookRun) {
  const run = cwd === undefined || cwd === "" ? command : `cd ${JSON.stringify(cwd)} && ${command}`;

  return sb.run("bash", ["-c", run], { env: { ...ROOT_VARS, ...env }, input: JSON.stringify(payload) });
}

function json(r: Run): Record<string, unknown> {
  const doc: unknown = JSON.parse(r.stdout);

  if (!isRecord(doc)) throw new Error(`not a JSON object: ${tail(r.out)}`);

  return doc;
}

export function output(r: Run): Record<string, unknown> {
  const doc = json(r).hookSpecificOutput;

  if (!isRecord(doc)) throw new Error(`no hookSpecificOutput: ${tail(r.out)}`);

  return doc;
}

/** The codex payload every codex case starts from: a PreToolUse from the repo root. */
export function codexBase(sb: Sandbox) {
  return {
    cwd: sb.repo,
    hook_event_name: "PreToolUse",
    model: "gpt-5",
    session_id: "codex-e2e",
    transcript_path: null,
    turn_id: "t1",
  };
}

/** The claude payload every claude case starts from, with `extra` on top. */
export function claudePayload(sb: Sandbox, extra: Record<string, unknown>) {
  return {
    cwd: sb.repo,
    session_id: "claude-e2e",
    transcript_path: path.join(sb.root, "transcript.jsonl"),
    ...extra,
  };
}
