import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AGENT_DEFAULTS } from "../agent-defaults.constants.ts";
import { claudeSession } from "./__fixtures__/fast-session.ts";
import { orchestrateKit, replyOf, type HookOut } from "./__fixtures__/orchestrate-kit.ts";
import { DRAFT_ROADMAP, VALID_PLAN } from "./__fixtures__/persist-bodies.ts";
import { runHookAsync } from "./__fixtures__/run-hook.ts";
import { main, mainWith } from "./orchestrate-parent.ts";
import { AWAY_STOP_REASON } from "./orchestrate.constants.ts";

const kit = orchestrateKit();

/** A host whose stdin read fails and that must get no reply. */
const BROKEN_IO = {
  readChunk: (): Uint8Array | null => {
    throw new Error("stdin gone");
  },
  write: (_text: string): void => {
    throw new Error("no reply expected");
  },
};

const FAST_BODY = [
  "FAST_PLAN_NAME: add tmp ignore",
  "commit: chore: ignore .tmp",
  "# add-tmp-ignore",
  "",
  "## Goal",
  "Ignore `.tmp/` in git.",
  "",
  "## Steps",
  "1 [ ] add `.tmp/` to `.gitignore`",
  "",
  "## Verify",
  "2 [ ] `git check-ignore .tmp/x` prints it",
  "",
].join("\n");

/** A temp workspace whose repo.config.ts sets `agents` to `agents`, written as source. */
function workspace(agents: string | null): string {
  const ws = kit.temp();

  if (agents !== null)
    fs.writeFileSync(path.join(ws, "repo.config.ts"), `export default { packs: ["agents"], agents: ${agents} };\n`);

  return ws;
}

/** The fields of one event this suite sends. */
type Payload = {
  readonly hook_event_name: string;
  readonly prompt?: string;
  readonly last_assistant_message?: string;
  readonly tool_name?: string;
  readonly tool_input?: { readonly content?: string; readonly file_path: string };
};

/** One event sent the way Claude Code sends it, through the hook's real entry. */
async function send(ws: string, sid: string, payload: Payload): Promise<HookOut | null> {
  const env = { CLAUDE_PROJECT_DIR: ws, REPO_BOARD_HOME: kit.temp("orch-board-") };

  return replyOf(await runHookAsync(main, { cwd: ws, session_id: sid, ...payload }, env));
}

async function say(ws: string, sid: string, prompt: string): Promise<string> {
  const out = await send(ws, sid, { hook_event_name: "UserPromptSubmit", prompt });

  return out?.hookSpecificOutput.additionalContext ?? "";
}

function stop(ws: string, sid: string, msg: string): Promise<HookOut | null> {
  return send(ws, sid, { hook_event_name: "Stop", last_assistant_message: msg });
}

/** A new item written through the hook; returns the text it would land. */
async function write(ws: string, sid: string, item: { file: string; content: string }): Promise<string> {
  const { file, content } = item;

  const out = await send(ws, sid, {
    hook_event_name: "PreToolUse",
    tool_input: { content, file_path: file },
    tool_name: "Write",
  });

  return out?.hookSpecificOutput.updatedInput.content ?? "";
}

describe("agents.defaultMode", () => {
  it("away runs an unstamped session under away: the prompt context and Stop both", async () => {
    const ws = workspace('{ defaultMode: "away" }');
    expect(await say(ws, "d1", "go")).toMatch(/^sessionGate=away\b/);
    expect(await stop(ws, "d1", "Keep --json?")).toStrictEqual({ decision: "block", reason: AWAY_STOP_REASON });
  });

  it("an /ask stamp beats a default of away", async () => {
    const ws = workspace('{ defaultMode: "away" }');
    expect(await say(ws, "d2", "/ask")).toMatch(/^sessionGate=ask\b/);
    expect(await say(ws, "d2", "go")).toMatch(/^sessionGate=ask\b/);
    expect(await stop(ws, "d2", "Keep --json?")).toBeNull();
  });

  it("an in-progress plan's mode: ask beats a default of away", async () => {
    const ws = workspace('{ defaultMode: "away" }');
    const s = claudeSession(kit, ws, "d3");
    const saved = s.save(".repo/plans/x.md", VALID_PLAN.replace("strategy: free", "strategy: free\nmode: ask"));
    fs.writeFileSync(saved, fs.readFileSync(saved, "utf8").replace(/^status: .*$/m, "status: in-progress"));
    expect(await say(ws, "d3", "go")).toMatch(/^sessionGate=ask\b/);
    expect(await stop(ws, "d3", "Keep --json?")).toBeNull();
  });

  it.each([
    ["no config", null],
    ["an invalid config", '{ defaultMode: "later" }'],
  ])("%s gives ask and the hook still answers", async (_name, agents) => {
    const ws = workspace(agents);
    expect(await say(ws, "d4", "go")).toMatch(/^sessionGate=ask\b/);
    expect(await stop(ws, "d4", "Keep --json?")).toBeNull();
  });
});

describe("agents.defaultStrategy", () => {
  it("fills a new plan and a new roadmap written without strategy, and leaves a fast plan without one", async () => {
    const ws = workspace('{ defaultStrategy: "spawn-deep" }');

    const planText = await write(ws, "s1", {
      content: VALID_PLAN.replace(/^strategy:.*\n/m, ""),
      file: ".repo/plans/x.md",
    });

    expect(planText).toMatch(/^strategy: spawn-deep$/m);

    const roadmapText = await write(ws, "s1", {
      content: DRAFT_ROADMAP.replace(/^strategy:.*\n/m, ""),
      file: ".repo/roadmaps/x.md",
    });

    expect(roadmapText).toMatch(/^strategy: spawn-deep$/m);
    const fast = await write(ws, "s1", { content: FAST_BODY, file: ".repo/plans-fast/x.md" });
    expect(fast).toMatch(/^serial: 1$/m);
    expect(fast).not.toMatch(/^strategy:/m);
  });

  it("keeps a sent strategy over the default", async () => {
    const ws = workspace('{ defaultStrategy: "spawn-deep" }');

    const content = VALID_PLAN.replace("strategy: free", "strategy: spawn-fast");
    const text = await write(ws, "s2", { content, file: ".repo/plans/x.md" });

    expect(text.match(/^strategy:.*$/gm)).toStrictEqual(["strategy: spawn-fast"]);
  });
});

describe("the hook entry", () => {
  it("ends with exit 0 and no reply when the stdin read fails, with defaults loaded or given", async () => {
    expect(await main([], BROKEN_IO)).toBe(0);
    expect(mainWith(AGENT_DEFAULTS)([], BROKEN_IO)).toBe(0);
  });

  it("denies a Write with no tool input and passes one that names no file, as before the defaults", async () => {
    const ws = workspace('{ defaultStrategy: "spawn-deep" }');
    const bare = await send(ws, "e1", { hook_event_name: "PreToolUse", tool_name: "Write" });
    expect(bare?.hookSpecificOutput.permissionDecision).toBe("deny");

    const unnamed = await send(ws, "e1", {
      hook_event_name: "PreToolUse",
      tool_input: { content: "x", file_path: "" },
      tool_name: "Write",
    });

    expect(unnamed).toBeNull();
  });
});
