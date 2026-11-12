import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { camelCall, replyCommand, replyInput, replyOf } from "./__fixtures__/hook-payload.ts";
import { runHook, spawnHook } from "./__fixtures__/run-hook.ts";
import { main as gateMain, processHookPayload } from "./gate-fat-tools.ts";
import { answerDeny, answerRewrite } from "./gate-harness.ts";
import { DEFAULT_GREP_HEAD_LIMIT, REASON_DENYLIST } from "./gate.constants.ts";
import type { HookInput } from "./hook-input.ts";
import { main as orchMain } from "./orchestrate-parent.ts";
import { ORCHESTRATOR_LOGS_DIR } from "./orchestrate.constants.ts";

const tmp = useTmp();
const GROK = { GROK_HOOK_EVENT: "pre_tool_use" };

function pre(tool: string, input: Record<string, unknown>, extra: HookInput = {}) {
  return camelCall(tool, input, { hookEventName: "PreToolUse", ...extra });
}

/** A parent grep of `src` for `foo`, and the input orchestrate-parent rewrites it to. */
const SRC_GREP = { path: "src", pattern: "foo" };
const SRC_GREP_LIMITED = { head_limit: DEFAULT_GREP_HEAD_LIMIT, ...SRC_GREP };

/** orchestrate-parent's exit status and rewritten input for `payload` under `env`. */
function orchRewrite(payload: HookInput, env: Record<string, string> = GROK) {
  const result = runHook(orchMain, payload, env);

  return { input: replyInput(replyOf(result.stdout)), status: result.status };
}

describe("gate-fat-tools adapter (stdin)", () => {
  it("fail-opens on invalid JSON", () => {
    const result = runHook(gateMain, "{not json");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("emits deny JSON with permissionDecision", () => {
    const data = pre("grep", { path: "node_modules", pattern: "x" });
    const result = runHook(gateMain, data);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toStrictEqual(answerDeny(data, REASON_DENYLIST));
  });

  it("emits updatedInput for missing grep limit", () => {
    const data: HookInput = { tool_input: { pattern: "foo" }, tool_name: "Grep" };
    const result = runHook(gateMain, data);
    expect(result.status).toBe(0);
    const next = { head_limit: DEFAULT_GREP_HEAD_LIMIT, pattern: "foo" };
    expect(JSON.parse(result.stdout)).toStrictEqual(answerRewrite(data, next));
  });
});

describe("repo hook gate-fat-tools (spawned)", () => {
  it("denies a denylisted grep path through the real entry", () => {
    const data = pre("grep", { path: "node_modules", pattern: "x" });
    const result = spawnHook("gate-fat-tools", data);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toStrictEqual(answerDeny(data, REASON_DENYLIST));
  });
});

describe("orchestrate-parent fat tools (Grok SSOT)", () => {
  it("allows parent grep and injects head_limit", () => {
    const { input, status } = orchRewrite(pre("grep", SRC_GREP));
    expect(status).toBe(0);
    expect(input).toStrictEqual(SRC_GREP_LIMITED);
  });

  it("parent-escape still fat-gates grep head_limit", () => {
    const ws = tmp.dir("orch-fat-escape-");
    fs.mkdirSync(path.join(ws, ORCHESTRATOR_LOGS_DIR), { recursive: true });
    fs.writeFileSync(path.join(ws, ORCHESTRATOR_LOGS_DIR, "parent-escape-ge"), "1");
    const payload = pre("grep", SRC_GREP, { sessionId: "ge", workspaceRoot: ws });
    const { input, status } = orchRewrite(payload, { ...GROK, GROK_SESSION_ID: "ge", GROK_WORKSPACE_ROOT: ws });
    expect(status).toBe(0);
    expect(input).toStrictEqual(SRC_GREP_LIMITED);
  });

  it("denies denylist read", () => {
    const result = runHook(orchMain, pre("read_file", { target_file: "dist/bundle.js" }), GROK);
    expect(replyOf(result.stdout)?.decision).toBe("block");
  });

  it("rewrites parent ls to rtk", () => {
    const result = runHook(orchMain, pre("run_terminal_command", { command: "ls" }), GROK);
    expect(result.status).toBe(0);
    expect(replyCommand(replyOf(result.stdout))).toBe("rtk ls");
  });
});

describe("processHookPayload", () => {
  it("returns null when there is nothing to do", () => {
    expect(processHookPayload(camelCall("todo_write", {}))).toBeNull();
  });
});
