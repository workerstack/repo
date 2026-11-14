import fs from "node:fs";
import path from "node:path";

import { expect } from "vitest";

import { main } from "../orchestrate-parent.ts";
import { must, orchestrateKit, replyOf, type HookOut } from "./orchestrate-kit.ts";
import { DRAFT_ROADMAP, VALID_PLAN } from "./persist-bodies.ts";
import { runHookAsync } from "./run-hook.ts";

export const ADVICE = "advice: spawn-deep because the hook and gate change together";

export const FRESH_DENY =
  "strategy: is set from the session, the roadmap or the config; " +
  "send advice: {free|spawn-fast|spawn-deep} because {reason}";

export const BAD_ADVICE = "advice: {free|spawn-fast|spawn-deep} because {reason}, at most 100 characters";

/** A fresh plan body: no `strategy:` line, with the agent's advice. */
export const PLAN = VALID_PLAN.replace("PLAN_NAME: add tmp ignore", `PLAN_NAME: add tmp ignore\n${ADVICE}`);
export const ROADMAP = DRAFT_ROADMAP.replace("ROADMAP_NAME: auth program", `ROADMAP_NAME: auth program\n${ADVICE}`);

/** `body` with a `strategy:` line after its name line, as an agent that still sends one would write it. */
export function sending(body: string, strategy: string): string {
  return body.replace(/^(?:PLAN|ROADMAP)_NAME:.*$/m, (line) => `${line}\nstrategy: ${strategy}`);
}

type Out = HookOut["hookSpecificOutput"] | null;

/** A workspace and the session id a hook event is sent as. */
type Session = { ws: string; sid: string };

type ToolInput = { content: string; file_path: string } | { file_path: string; new_string: string; old_string: string };

type Payload =
  | { hook_event_name: "UserPromptSubmit"; prompt: string }
  | { hook_event_name: "PreToolUse"; tool_input: ToolInput; tool_name: "Write" | "Edit" };

type Landed = { text: string; file: string };

export function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

export function strategyLines(text: string): string[] {
  return text.match(/^strategy:.*$/gm) ?? [];
}

/** The hook sends, saves and reads the strategy tests share; the kit owns the temp dirs. */
export function saveStrategyKit() {
  const kit = orchestrateKit();

  /** A temp workspace; `defaultStrategy` is written into its repo.config.ts when given. */
  function workspace(defaultStrategy?: string): string {
    const ws = kit.temp();

    if (defaultStrategy !== undefined) {
      const config = `export default { packs: ["agents"], agents: { defaultStrategy: "${defaultStrategy}" } };\n`;
      fs.writeFileSync(path.join(ws, "repo.config.ts"), config);
    }

    return ws;
  }

  /** One event sent the way Claude Code sends it, through the hook's real entry. */
  async function send({ ws, sid }: Session, payload: Payload): Promise<Out> {
    const env = { CLAUDE_PROJECT_DIR: ws, REPO_BOARD_HOME: kit.temp("orch-board-") };
    const out = replyOf(await runHookAsync(main, { cwd: ws, session_id: sid, ...payload }, env));

    return out?.hookSpecificOutput ?? null;
  }

  async function set(ws: string, sid: string, words: string): Promise<void> {
    await send({ sid, ws }, { hook_event_name: "UserPromptSubmit", prompt: `/set ${words}` });
  }

  function write(session: Session, file: string, content: string): Promise<Out> {
    return send(session, {
      hook_event_name: "PreToolUse",
      tool_input: { content, file_path: file },
      tool_name: "Write",
    });
  }

  function edit(session: Session, file: string, change: { from: string; to: string }): Promise<Out> {
    return send(session, {
      hook_event_name: "PreToolUse",
      tool_input: { file_path: file, new_string: change.to, old_string: change.from },
      tool_name: "Edit",
    });
  }

  /** The text a Write would land, and the file it lands at. */
  function landed(out: Out): Landed {
    const updated = must(out).updatedInput;
    expect(out?.permissionDecision, out?.permissionDecisionReason).not.toBe("deny");

    return { file: updated.file_path, text: updated.content };
  }

  /** Saves a fresh plan as `sid` and returns its path. */
  async function savedPlan(ws: string, sid: string): Promise<string> {
    return landed(await write({ sid, ws }, ".repo/plans/x.md", PLAN)).file;
  }

  /** Marks the file as `status` with its strategy `strategy`, as a person's approval and a lock would leave it. */
  function plant(file: string, fields: { status: string; strategy: string }): void {
    fs.writeFileSync(
      file,
      read(file)
        .replace(/^status: .*$/m, `status: ${fields.status}`)
        .replace(/^reviews: .*$/m, "reviews: 1")
        .replace(/^strategy: .*$/m, `strategy: ${fields.strategy}`),
    );
  }

  /** A roadmap this session saved, then left in progress with `strategy`; returns its path. */
  async function inProgressRoadmap(ws: string, sid: string, strategy: string): Promise<string> {
    const file = landed(await write({ sid, ws }, ".repo/roadmaps/x.md", ROADMAP)).file;
    plant(file, { status: "in-progress", strategy });

    return file;
  }

  return { edit, inProgressRoadmap, landed, plant, read, savedPlan, set, strategyLines, workspace, write };
}
