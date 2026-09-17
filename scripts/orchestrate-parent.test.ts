import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ASK_STOP_REASON,
  SESSION_GATE_STAMP,
  TMP_RESERVED_DIRS,
  hasStepAsk,
  isUnderTmp,
} from "../.grok/hooks/orchestrate-parent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const orchParent = path.join(root, ".grok/hooks/orchestrate-parent.js");

function runHook(
  payload: unknown,
  env: NodeJS.ProcessEnv = {},
) {
  return spawnSync(process.execPath, [orchParent], {
    encoding: "utf8",
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    cwd: root,
    env: { ...process.env, ...env },
    timeout: 10_000,
  });
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrate-parent-"));
  tmpDirs.push(dir);
  return dir;
}

const childMsg = "```js\nconst x = 1;\n```\nwrite file src/x.ts";

describe("orchestrate-parent SubagentStop intercept", () => {
  it("child Stop without need: still no-ops", () => {
    const result = runHook(
      {
        hookEventName: "Stop",
        reason: "end_turn",
        subagentType: "grunt",
        lastAssistantMessage: childMsg,
      },
      { GROK_HOOK_EVENT: "stop" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("SubagentStop and Stop+subagentType with a search need: blocks and contains facts", () => {
    const ws = workspace();
    fs.writeFileSync(path.join(ws, "hit.txt"), "unique-intercept-token-xyz\n");
    const need =
      'need: [{"job":"search","query":"unique-intercept-token-xyz"}]';
    for (const [event, hookEvent] of [
      ["SubagentStop", "subagent_stop"],
      ["Stop", "stop"],
    ] as const) {
      const result = runHook(
        {
          hookEventName: event,
          reason: "end_turn",
          subagentType: "grunt",
          lastAssistantMessage: need,
          workspaceRoot: ws,
          sessionId: "i-" + event,
        },
        {
          GROK_HOOK_EVENT: hookEvent,
          GROK_WORKSPACE_ROOT: ws,
          GROK_SESSION_ID: "i-" + event,
        },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("1 match.");
      const json = JSON.parse(result.stdout);
      expect(json.decision).toBe("block");
      expect(json.hookSpecificOutput.additionalContext).toContain("1 match.");
      expect(json.hookSpecificOutput.additionalContext).toContain(
        "unique-intercept-token-xyz",
      );
      expect(json.hookSpecificOutput.hookEventName).toBe(event);
    }
  });

  it("need path glob cwd not dropped", () => {
    const ws = workspace();
    fs.mkdirSync(path.join(ws, "keep"));
    fs.mkdirSync(path.join(ws, "skip"));
    fs.writeFileSync(path.join(ws, "keep", "hit.txt"), "extra-token-zzz\n");
    fs.writeFileSync(path.join(ws, "skip", "hit.txt"), "extra-token-zzz\n");
    fs.writeFileSync(path.join(ws, "keep", "hit.md"), "extra-token-zzz\n");
    const result = runHook(
      {
        hookEventName: "SubagentStop",
        subagentType: "grunt",
        lastAssistantMessage:
          'need: [{"job":"search","query":"extra-token-zzz","path":"keep","glob":"*.txt","cwd":"."}]',
        workspaceRoot: ws,
        sessionId: "extras",
      },
      {
        GROK_HOOK_EVENT: "subagent_stop",
        GROK_WORKSPACE_ROOT: ws,
        GROK_SESSION_ID: "extras",
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("keep/hit.txt");
    expect(result.stdout).not.toContain("skip/hit.txt");
    expect(result.stdout).not.toContain("hit.md");
  });

  it("mixed web need: does not intercept", () => {
    const ws = workspace();
    const result = runHook(
      {
        hookEventName: "SubagentStop",
        subagentType: "grunt",
        lastAssistantMessage:
          'need: [{"job":"search","query":"x"},{"job":"web","query":"https://example.com"}]',
        workspaceRoot: ws,
        sessionId: "mix",
      },
      {
        GROK_HOOK_EVENT: "subagent_stop",
        GROK_WORKSPACE_ROOT: ws,
        GROK_SESSION_ID: "mix",
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});

describe("orchestrate-parent hook config", () => {
  it("spawn rewrite and session read still emit JSON", () => {
    const ws = workspace();
    const file = path.join(ws, "small.txt");
    fs.writeFileSync(file, "abc");
    const spawn = runHook(
      {
        hookEventName: "PreToolUse",
        toolName: "spawn_subagent",
        toolInput: {
          subagent_type: "grunt",
          resume_from: "child-1",
          prompt: "You are grunt subagent. ship it",
        },
        workspaceRoot: ws,
      },
      { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: ws },
    );
    expect(spawn.status).toBe(0);
    const spawnJson = JSON.parse(spawn.stdout);
    expect(spawnJson.decision || spawnJson.hookSpecificOutput).toBeTruthy();
    const read = runHook(
      {
        hookEventName: "PreToolUse",
        toolName: "read_file",
        toolInput: { target_file: file },
        workspaceRoot: ws,
      },
      { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: ws },
    );
    expect(read.status).toBe(0);
    const readJson = JSON.parse(read.stdout);
    expect(readJson.decision || readJson.hookSpecificOutput).toBeTruthy();
    expect(readJson.decision).not.toBe("deny");
  });

  it("need ok vs fail; intercept FALLBACK", () => {
    const ws = workspace();
    fs.writeFileSync(path.join(ws, "hit.txt"), "ok-token-aaa\n");
    const ok = runHook(
      {
        hookEventName: "SubagentStop",
        subagentType: "grunt",
        lastAssistantMessage: 'need: [{"job":"search","query":"ok-token-aaa"}]',
        workspaceRoot: ws,
        sessionId: "tok",
      },
      {
        GROK_HOOK_EVENT: "subagent_stop",
        GROK_WORKSPACE_ROOT: ws,
        GROK_SESSION_ID: "tok",
      },
    );
    expect(ok.stdout).toContain("1 match.");
    expect(() => JSON.parse(ok.stdout)).not.toThrow();
    const fail = runHook(
      {
        hookEventName: "SubagentStop",
        subagentType: "grunt",
        lastAssistantMessage: "not a need dump",
        workspaceRoot: ws,
        sessionId: "tfail",
      },
      {
        GROK_HOOK_EVENT: "subagent_stop",
        GROK_WORKSPACE_ROOT: ws,
        GROK_SESSION_ID: "tfail",
      },
    );
    expect(fail.stdout).toBe("");
    const fb = runHook(
      {
        hookEventName: "SubagentStop",
        subagentType: "grunt",
        lastAssistantMessage:
          'need: [{"job":"search","query":"foo node_modules"}]',
        workspaceRoot: ws,
        sessionId: "tfb",
      },
      {
        GROK_HOOK_EVENT: "subagent_stop",
        GROK_WORKSPACE_ROOT: ws,
        GROK_SESSION_ID: "tfb",
      },
    );
    expect(fb.stdout).toBe("");
  });

  it("orchestrate-parent.json still has no SessionStart", () => {
    const json = JSON.parse(
      fs.readFileSync(path.join(root, ".grok/hooks/orchestrate-parent.json"), "utf8"),
    );
    expect(json.hooks.SessionStart).toBeUndefined();
    expect(JSON.stringify(json)).not.toMatch(/SessionStart/);
  });

  it("claude settings deny Agent(orchestrator); hooks.jsonc has Stop + UserPromptSubmit", () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(root, ".claude/settings.json"), "utf8"),
    );
    expect(settings.permissions.deny).toContain("Agent(orchestrator)");
    const ssot = fs.readFileSync(path.join(root, ".rulesync/hooks.jsonc"), "utf8");
    expect(ssot).toMatch(/"stop"/);
    expect(ssot).toMatch(/"beforeSubmitPrompt"/);
    expect(ssot).not.toMatch(/"userPromptSubmit"/);
    expect(ssot).toMatch(/orchestrate-parent\.js/);
    const jsonc = JSON.parse(
      ssot.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
    );
    expect(Object.keys(jsonc.hooks)).toEqual(
      expect.arrayContaining(["preToolUse", "beforeSubmitPrompt", "stop"]),
    );
    expect(Object.keys(jsonc.hooks)).not.toContain("userPromptSubmit");
    expect(jsonc.hooks.beforeSubmitPrompt[0].command).toMatch(/orchestrate-parent\.js/);
    expect(jsonc.hooks.beforeSubmitPrompt[0].timeout).toBe(5);
    expect(JSON.stringify(settings.hooks?.SubagentStop)).toMatch(
      /orchestrate-parent\.js/,
    );
    const grokJson = JSON.parse(
      fs.readFileSync(
        path.join(root, ".grok/hooks/orchestrate-parent.json"),
        "utf8",
      ),
    );
    expect(JSON.stringify(grokJson.hooks?.SubagentStop)).toMatch(
      /orchestrate-parent\.js/,
    );
  });

  it("hooks generate --check loads canonical beforeSubmitPrompt", () => {
    const result = spawnSync(
      path.join(
        root,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "rulesync.cmd" : "rulesync",
      ),
      ["generate", "-t", "claudecode,codexcli,antigravity-cli", "-f", "hooks", "--check"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 60_000,
        shell: process.platform === "win32",
      },
    );
    const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    expect(combined).not.toMatch(/Failed to load Rulesync hooks file/);
    expect(combined).not.toMatch(/unknown hook event name\(s\): userPromptSubmit/);
    expect(result.status).toBe(0);
    const claude = JSON.parse(
      fs.readFileSync(path.join(root, ".claude/settings.json"), "utf8"),
    ).hooks;
    expect(JSON.stringify(claude.PreToolUse)).toMatch(/scrub-spawn-prompt/);
    expect(JSON.stringify(claude.PreToolUse)).toMatch(/gate-fat-tools/);
    expect(JSON.stringify(claude.UserPromptSubmit)).toMatch(/orchestrate-parent\.js/);
    expect(JSON.stringify(claude.Stop ?? claude.stop)).toMatch(/orchestrate-parent\.js/);
    const codex = JSON.parse(
      fs.readFileSync(path.join(root, ".codex/hooks.json"), "utf8"),
    ).hooks;
    expect(JSON.stringify(codex.PreToolUse)).toMatch(/scrub-spawn-prompt/);
    expect(JSON.stringify(codex.UserPromptSubmit)).toMatch(/orchestrate-parent\.js/);
    expect(JSON.stringify(codex.Stop ?? codex.stop)).toMatch(/orchestrate-parent\.js/);
    const ag = JSON.parse(
      fs.readFileSync(path.join(root, ".agents/hooks.json"), "utf8"),
    ).rulesync;
    expect(JSON.stringify(ag.PreToolUse)).toMatch(/scrub-spawn-prompt/);
    expect(JSON.stringify(ag.PreToolUse)).toMatch(/gate-fat-tools/);
    expect(ag.UserPromptSubmit).toBeUndefined();
    expect(ag.beforeSubmitPrompt).toBeUndefined();
    expect(ag.userPromptSubmit).toBeUndefined();
    expect(JSON.stringify(ag.Stop ?? ag.stop)).toMatch(/orchestrate-parent\.js/);
    expect(fs.existsSync(path.join(root, ".grok/hooks/orchestrate-parent.js"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(root, ".grok/hooks/orchestrate-parent.json"))).toBe(
      true,
    );
  }, 60_000);
});

describe("isUnderTmp", () => {
  it("matches root files and rejects reserved and nested paths", () => {
    const ws = "/ws";
    expect(TMP_RESERVED_DIRS).toEqual(
      new Set(["plans", "handoffs", "implementations", "browser", "orchestrator-logs", "stash", "sessions"]),
    );
    expect(isUnderTmp(".tmp/grunt/notes.md", ws)).toBe(true);
    expect(isUnderTmp(path.join(ws, ".tmp/grunt/1-x-20260827T143000Z.md"), ws)).toBe(
      true,
    );
    expect(isUnderTmp(".tmp/grunt/tmp/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/grunt/browser/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/grunt/orchestrator-logs/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/grunt/cov/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/grunt/plans/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/grunt/handoffs/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/grunt/implementations/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/grunt/plans", ws)).toBe(false);
    expect(isUnderTmp(".tmp/grunt/handoffs", ws)).toBe(false);
    expect(isUnderTmp(".tmp/grunt/implementations", ws)).toBe(false);
    expect(isUnderTmp(".tmp/grunt/browser", ws)).toBe(false);
    expect(isUnderTmp(".tmp/grunt/orchestrator-logs", ws)).toBe(false);
  });
});

describe("sessionGate /auto /ask", () => {
  function stampAbs(ws: string, sid: string) {
    return path.join(ws, ".tmp/grunt/orchestrator-logs", `${SESSION_GATE_STAMP}-${sid}`);
  }

  it("hasStepAsk is true on a question; wait-grunt is exact", () => {
    expect(hasStepAsk("wrote src/a.ts\nContinue?")).toBe(true);
    expect(hasStepAsk("wrote src/a.ts")).toBe(false);
    expect(hasStepAsk("[orchestrator]: wait grunt")).toBe(true);
  });

  it("UserPromptSubmit default additionalContext is sessionGate=auto", () => {
    const ws = workspace();
    const r = runHook(
      { hookEventName: "UserPromptSubmit", prompt: "ship it", workspaceRoot: ws, sessionId: "s1" },
      { GROK_HOOK_EVENT: "user_prompt_submit", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: "s1" },
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toMatch(
      /sessionGate=auto/,
    );
  });

  it("/ask stamps; /auto unlinks back to auto", () => {
    const ws = workspace();
    const sid = "g1";
    const ask = runHook(
      { hookEventName: "UserPromptSubmit", prompt: "/ask", workspaceRoot: ws, sessionId: sid },
      { GROK_HOOK_EVENT: "user_prompt_submit", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: sid },
    );
    expect(ask.status).toBe(0);
    expect(fs.readFileSync(stampAbs(ws, sid), "utf8")).toBe("ask");
    expect(JSON.parse(ask.stdout).hookSpecificOutput.additionalContext).toMatch(
      /sessionGate=ask/,
    );

    const back = runHook(
      { hookEventName: "UserPromptSubmit", prompt: "/auto", workspaceRoot: ws, sessionId: sid },
      { GROK_HOOK_EVENT: "user_prompt_submit", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: sid },
    );
    expect(back.status).toBe(0);
    expect(fs.existsSync(stampAbs(ws, sid))).toBe(false);
    expect(JSON.parse(back.stdout).hookSpecificOutput.additionalContext).toMatch(
      /sessionGate=auto/,
    );

    const again = runHook(
      { hookEventName: "UserPromptSubmit", prompt: "/ask", workspaceRoot: ws, sessionId: sid },
      { GROK_HOOK_EVENT: "user_prompt_submit", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: sid },
    );
    expect(again.status).toBe(0);
    expect(fs.readFileSync(stampAbs(ws, sid), "utf8")).toBe("ask");
    expect(JSON.parse(again.stdout).hookSpecificOutput.additionalContext).toMatch(
      /sessionGate=ask/,
    );
  });

  it("sid-less /ask does not stamp", () => {
    const ws = workspace();
    runHook(
      { hookEventName: "UserPromptSubmit", prompt: "/ask", workspaceRoot: ws },
      {
        GROK_HOOK_EVENT: "user_prompt_submit",
        GROK_WORKSPACE_ROOT: ws,
        GROK_SESSION_ID: "",
      },
    );
    expect(fs.existsSync(path.join(ws, ".tmp/grunt/orchestrator-logs"))).toBe(false);
  });

  it("ask Stop without a question blocks; with a question or wait-grunt allows; auto allows", () => {
    const ws = workspace();
    const sid = "stop1";
    runHook(
      { hookEventName: "UserPromptSubmit", prompt: "/ask", workspaceRoot: ws, sessionId: sid },
      { GROK_HOOK_EVENT: "user_prompt_submit", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: sid },
    );
    const blocked = runHook(
      {
        hookEventName: "Stop",
        reason: "end_turn",
        lastAssistantMessage: "wrote src/a.ts",
        workspaceRoot: ws,
        sessionId: sid,
      },
      { GROK_HOOK_EVENT: "stop", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: sid },
    );
    expect(JSON.parse(blocked.stdout).decision).toBe("block");
    expect(JSON.parse(blocked.stdout).reason).toBe(ASK_STOP_REASON);

    const asked = runHook(
      {
        hookEventName: "Stop",
        reason: "end_turn",
        lastAssistantMessage: "wrote src/a.ts\nContinue?",
        workspaceRoot: ws,
        sessionId: sid,
      },
      { GROK_HOOK_EVENT: "stop", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: sid },
    );
    expect(asked.stdout).toBe("");

    const wait = runHook(
      {
        hookEventName: "Stop",
        reason: "end_turn",
        lastAssistantMessage: "[orchestrator]: wait grunt",
        workspaceRoot: ws,
        sessionId: sid,
      },
      { GROK_HOOK_EVENT: "stop", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: sid },
    );
    expect(wait.stdout).toBe("");

    runHook(
      { hookEventName: "UserPromptSubmit", prompt: "/auto", workspaceRoot: ws, sessionId: sid },
      { GROK_HOOK_EVENT: "user_prompt_submit", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: sid },
    );
    const autoStop = runHook(
      {
        hookEventName: "Stop",
        reason: "end_turn",
        lastAssistantMessage: "wrote src/a.ts",
        workspaceRoot: ws,
        sessionId: sid,
      },
      { GROK_HOOK_EVENT: "stop", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: sid },
    );
    expect(autoStop.stdout).toBe("");
  });
});
