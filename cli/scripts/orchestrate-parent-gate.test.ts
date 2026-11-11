import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { probeProcess, readBootId } from "./board.ts";
import { must, orchestrateKit, parseJson, replyOf } from "./fixtures/orchestrate-kit.ts";
import { hasStepAsk } from "./orchestrate-transcript.ts";
import { ASK_STOP_REASON, SESSION_GATE_STAMP } from "./orchestrate.constants.ts";

const kit = orchestrateKit();
const stampAbs = (ws: string, sid: string) =>
  path.join(ws, ".tmp/repo/orchestrator-logs", `${SESSION_GATE_STAMP}-${sid}`);
/** The context a Grok prompt gets in `ws` as session `sid`. */
const say = (ws: string, sid: string, prompt: string) =>
  must(replyOf(kit.grok({ sid, ws }, "UserPromptSubmit", { prompt }))).hookSpecificOutput.additionalContext;
const stop = (ws: string, sid: string, msg: string) =>
  kit.grok({ sid, ws }, "Stop", { lastAssistantMessage: msg, reason: "end_turn" });

/** A live sibling session's board row in `board`, held by this process. */
function plantSibling(board: string): string {
  const live = must(probeProcess(process.pid));
  const boardDir = path.join(board, ".workerstack", "board");
  fs.mkdirSync(boardDir, { recursive: true });
  const row = { effort: "medium", model: "fable 51", provider: "claude", time: "2026-10-09T12:00:00Z" };
  const work = { cwd: "/home/user/x", session: "other", work: "sibling live work" };
  const owner = { boot: readBootId(), pid: live.pid, start: live.start };
  fs.writeFileSync(path.join(boardDir, "claude-other.json"), `${JSON.stringify({ ...row, ...work, ...owner })}\n`);
  return boardDir;
}

it("hasStepAsk is true on a question; wait-scout is exact", () => {
  expect(hasStepAsk("wrote src/a.ts\nContinue?")).toBe(true);
  expect(hasStepAsk("wrote src/a.ts")).toBe(false);
  expect(hasStepAsk("[orchestrator]: wait scout")).toBe(true);
});

it("UserPromptSubmit refreshes the row and appends other live lines", () => {
  const ws = kit.temp();
  const board = kit.temp("orch-board-");
  const boardDir = plantSibling(board);
  const call = { hookEventName: "UserPromptSubmit", prompt: "ship the auth fix", sessionId: "self", workspaceRoot: ws };
  const env = { GROK_HOOK_EVENT: "user_prompt_submit", GROK_SESSION_ID: "self", GROK_WORKSPACE_ROOT: ws };
  const r = kit.run(call, { ...env, REPO_BOARD_HOME: board, REPO_BOARD_PROVIDER: "claude" });
  const ctx = must(replyOf(r)).hookSpecificOutput.additionalContext;
  expect(ctx).toMatch(/sessionGate=auto/);
  expect(ctx).toContain("sibling live work");
  expect(ctx).not.toContain("ship the auth fix");
  const self = parseJson<{ work: string; session: string }>(
    fs.readFileSync(path.join(boardDir, "claude-self.json"), "utf8"),
  );
  expect(self.work).toBe("ship the auth fix");
  expect(self.session).toBe("self");
  expect(fs.existsSync(path.join(boardDir, "claude-other.json"))).toBe(true);
});

it("UserPromptSubmit default additionalContext is sessionGate=auto", () => {
  expect(say(kit.temp(), "s1", "ship it")).toMatch(/sessionGate=auto/);
});

it("/ask stamps; /auto unlinks back to auto", () => {
  const ws = kit.temp();
  const sid = "g1";
  expect(say(ws, sid, "/ask")).toMatch(/sessionGate=ask/);
  expect(fs.readFileSync(stampAbs(ws, sid), "utf8")).toBe("ask");
  expect(say(ws, sid, "/auto")).toMatch(/sessionGate=auto/);
  expect(fs.existsSync(stampAbs(ws, sid))).toBe(false);
  expect(say(ws, sid, "/ask")).toMatch(/sessionGate=ask/);
  expect(fs.readFileSync(stampAbs(ws, sid), "utf8")).toBe("ask");
});

it("sid-less /ask does not stamp", () => {
  const ws = kit.temp();
  kit.grok({ sid: "", ws }, "UserPromptSubmit", { prompt: "/ask" });
  expect(fs.existsSync(path.join(ws, ".tmp/repo/orchestrator-logs"))).toBe(false);
});

it("ask Stop without a question blocks; with a question or wait-scout allows; auto allows", () => {
  const ws = kit.temp();
  const sid = "stop1";
  say(ws, sid, "/ask");
  const blocked = must(replyOf(stop(ws, sid, "wrote src/a.ts")));
  expect(blocked.decision).toBe("block");
  expect(blocked.reason).toBe(ASK_STOP_REASON);
  expect(stop(ws, sid, "wrote src/a.ts\nContinue?").stdout).toBe("");
  expect(stop(ws, sid, "[orchestrator]: wait scout").stdout).toBe("");
  say(ws, sid, "/auto");
  expect(stop(ws, sid, "wrote src/a.ts").stdout).toBe("");
});
