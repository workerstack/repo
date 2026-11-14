import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { must, orchestrateKit, parseJson, replyOf } from "./__fixtures__/orchestrate-kit.ts";
import { probeProcess, readBootId } from "./board-process.ts";
import { SESSION_GATE_STAMP } from "./orchestrate.constants.ts";

const kit = orchestrateKit();

function stampAbs(ws: string, sid: string) {
  return path.join(ws, ".repo/tmp/orchestrator-logs", `${SESSION_GATE_STAMP}-${sid}`);
}

/** The context a Grok prompt gets in `ws` as session `sid`. */
function say(ws: string, sid: string, prompt: string) {
  return must(replyOf(kit.grok({ sid, ws }, "UserPromptSubmit", { prompt }))).hookSpecificOutput.additionalContext;
}

function stop(ws: string, sid: string, msg: string) {
  return kit.grok({ sid, ws }, "Stop", { lastAssistantMessage: msg, reason: "end_turn" });
}

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

it("UserPromptSubmit refreshes the row and appends other live lines", () => {
  const ws = kit.temp();
  const board = kit.temp("orch-board-");
  const boardDir = plantSibling(board);
  const call = { hookEventName: "UserPromptSubmit", prompt: "ship the auth fix", sessionId: "self", workspaceRoot: ws };
  const env = { GROK_HOOK_EVENT: "user_prompt_submit", GROK_SESSION_ID: "self", GROK_WORKSPACE_ROOT: ws };
  const r = kit.run(call, { ...env, REPO_BOARD_HOME: board, REPO_BOARD_PROVIDER: "claude" });
  const ctx = must(replyOf(r)).hookSpecificOutput.additionalContext;
  expect(ctx).toMatch(/sessionGate=ask/);
  expect(ctx).toContain("sibling live work");
  expect(ctx).not.toContain("ship the auth fix");

  const self = parseJson<{ work: string; session: string }>(
    fs.readFileSync(path.join(boardDir, "claude-self.json"), "utf8"),
  );

  expect(self.work).toBe("ship the auth fix");
  expect(self.session).toBe("self");
  expect(fs.existsSync(path.join(boardDir, "claude-other.json"))).toBe(true);
});

it("with no stamp the session gate is ask", () => {
  expect(say(kit.temp(), "s1", "ship it")).toMatch(/^sessionGate=ask\b/);
});

it("/ask stamps ask and /away stamps away", () => {
  const ws = kit.temp();
  const sid = "g1";
  expect(say(ws, sid, "/away")).toMatch(/sessionGate=away/);
  expect(fs.readFileSync(stampAbs(ws, sid), "utf8")).toBe("away");
  expect(say(ws, sid, "/ask")).toMatch(/sessionGate=ask/);
  expect(fs.readFileSync(stampAbs(ws, sid), "utf8")).toBe("ask");
});

it("a stamp left holding auto reads as ask", () => {
  const ws = kit.temp();
  fs.mkdirSync(path.dirname(stampAbs(ws, "g2")), { recursive: true });
  fs.writeFileSync(stampAbs(ws, "g2"), "auto");
  expect(say(ws, "g2", "go")).toMatch(/^sessionGate=ask\b/);
});

it("a prompt of exactly /auto writes no stamp", () => {
  const ws = kit.temp();
  say(ws, "g3", "/auto");
  expect(fs.existsSync(stampAbs(ws, "g3"))).toBe(false);
});

it("sid-less /ask does not stamp", () => {
  const ws = kit.temp();
  kit.grok({ sid: "", ws }, "UserPromptSubmit", { prompt: "/ask" });
  expect(fs.existsSync(path.join(ws, ".repo/tmp/orchestrator-logs"))).toBe(false);
});

it("ask Stop passes a reply with no question, with a question or with wait-scout", () => {
  const ws = kit.temp();
  const sid = "stop1";
  say(ws, sid, "/ask");
  expect(stop(ws, sid, "wrote src/a.ts").stdout).toBe("");
  expect(stop(ws, sid, "wrote src/a.ts\nContinue?").stdout).toBe("");
  expect(stop(ws, sid, "[orchestrator]: wait scout").stdout).toBe("");
});
