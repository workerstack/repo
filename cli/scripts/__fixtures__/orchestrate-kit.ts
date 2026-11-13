// Shared setup for the orchestrate-parent suites: temp dirs, typed replies, and payloads per host shape.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect } from "vitest";
import { VALID_LESSON } from "./persist-bodies.ts";
import { runHook, type HookRun } from "./run-hook.ts";
import { persistLesson } from "../lessons-ops.ts";
import { closingBlock } from "../closing-line.ts";
import { main } from "../orchestrate-parent.ts";
import type { Approvable, Strategy } from "../strategy.types.ts";

type Env = Record<string, string | undefined>;

/** The reply shapes the hook prints; fields are typed as present, and the matchers check the real values. */
export interface HookOut {
  decision: string;
  reason: string;
  permission?: string;
  user_message?: string;
  agent_message?: string;
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
    permissionDecision?: string;
    permissionDecisionReason: string;
    updatedInput: { file_path: string; path: string; content: string; command: string };
  };
}

/** Parses a hook's stdout or a config file into the shape a test reads. */
export function parseJson<T>(text: string): T {
  return JSON.parse(text) as T /* the caller names the shape the text holds */;
}

/** The reply of a run that exited 0; null when the hook printed nothing. */
export function replyOf(run: HookRun): HookOut | null {
  expect(run.status).toBe(0);
  return run.stdout ? parseJson<HookOut>(run.stdout) : null;
}

/** A value the case needs present; a missing one fails the case. */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

/** The workspace and session one Grok event is sent for; no sid sends none. */
export type GrokAt = { ws: string; sid?: string };
const GROK_EVENTS: Readonly<Record<string, string>> = {
  PreToolUse: "pre_tool_use",
  UserPromptSubmit: "user_prompt_submit",
  Stop: "stop",
  SubagentStop: "subagent_stop",
};

/** Grok's camelCase payload for `event`, with the env that names its event, workspace and session. */
export function grokCall(at: GrokAt, event: string, fields: Record<string, unknown> = {}): { payload: object; env: Env } {
  const sid = at.sid === undefined ? {} : { sessionId: at.sid };
  const env: Env = { GROK_HOOK_EVENT: GROK_EVENTS[event], GROK_WORKSPACE_ROOT: at.ws };
  if (at.sid !== undefined) env.GROK_SESSION_ID = at.sid;
  return { payload: { hookEventName: event, ...fields, workspaceRoot: at.ws, ...sid }, env };
}

/** Where a Claude-shaped write is sent from: its cwd, session and env. */
export type WriteAt = { cwd: string; sid: string; env?: Env };

/** Temp dirs removed after each case, and the hook run with a fresh board home unless the env names one. */
export interface OrchestrateKit {
  temp: (prefix?: string) => string;
  run: (payload: unknown, env?: Env) => HookRun;
  grok: (at: GrokAt, event: string, fields?: Record<string, unknown>) => HookRun;
  writeAs: (at: WriteAt, file: string, content: string) => HookRun;
}

export function orchestrateKit(): OrchestrateKit {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
      fs.rmSync(`${d}-alias`, { force: true });
    }
  });
  const temp = (prefix = "orchestrate-parent-"): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
  const run = (payload: unknown, env: Env = {}): HookRun =>
    runHook(main, payload, { ...env, REPO_BOARD_HOME: env.REPO_BOARD_HOME || temp("orch-board-") });
  const grok = (at: GrokAt, event: string, fields: Record<string, unknown> = {}): HookRun => {
    const call = grokCall(at, event, fields);
    return run(call.payload, call.env);
  };
  const writeAs = (at: WriteAt, file: string, content: string): HookRun =>
    run(
      { hook_event_name: "PreToolUse", session_id: at.sid, cwd: at.cwd, tool_name: "Write", tool_input: { file_path: file, content } },
      at.env,
    );
  return { temp, run, grok, writeAs };
}

/** A transcript whose last assistant reply is `text`. */
export function transcript(ws: string, text: string): string {
  const file = path.join(ws, "transcript.jsonl");
  const rec = (role: string, t: string): string =>
    JSON.stringify({ type: role, message: { role, content: [{ type: "text", text: t }] } });
  fs.writeFileSync(file, [rec("user", "write the plan"), rec("assistant", text)].join("\n") + "\n");
  return file;
}

/** The approval block a reply ends with for `items`, as the hooks render it. */
export const closing = (...items: Approvable[]): string => closingBlock(items);

/** A plan item as the approval block names it; the strategy is the default unless given. */
export const plan = (serial: number, strategy: Strategy = "free"): Approvable => ({ kind: "plan", serial, strategy });

/** A roadmap item as the approval block names it; the strategy is the default unless given. */
export const roadmap = (serial: number, strategy: Strategy = "free"): Approvable => ({
  kind: "roadmap",
  serial,
  strategy,
});

/** A fast plan item as the approval block names it: no strategy. */
export const fastPlan = (serial: number): Approvable => ({ kind: "fast-plan", serial });

/** A fast roadmap item as the approval block names it: no strategy. */
export const fastRoadmap = (serial: number): Approvable => ({ kind: "fast-roadmap", serial });

/** The `strategy:` a saved file holds. */
export const strategyOf = (file: string): string | undefined =>
  /^strategy: (.*)$/m.exec(fs.readFileSync(file, "utf8"))?.[1];

/** A git repo with one commit and a managed worktree at .worktrees/w, under a kit temp dir. */
export function gitRepo(kit: OrchestrateKit): { r: string; w: string } {
  const r = fs.realpathSync(kit.temp());
  const git = (...args: string[]) =>
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: r, encoding: "utf8" });
  git("init", "-q");
  fs.mkdirSync(path.join(r, "packages/a"), { recursive: true });
  fs.writeFileSync(path.join(r, "packages/a/index.js"), "x\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  git("worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
  return { r, w: path.join(r, ".worktrees/w") };
}

/** `dir/src/a.ts`, the file VALID_LESSON's paths match. */
export function plantSource(dir: string): void {
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/a.ts"), "x\n");
}

/** VALID_LESSON rendered and saved at `dir/.repo/lessons/plan-forks.md`, as a host would land it; returns its path. */
export function plantLesson(dir: string): string {
  const lesson = path.join(dir, ".repo/lessons/plan-forks.md");
  const rendered = persistLesson({ workspaceRoot: dir, filePath: lesson, content: VALID_LESSON });
  expect(rendered.ok, rendered.error).toBe(true);
  fs.writeFileSync(lesson, must(rendered.content));
  return lesson;
}
