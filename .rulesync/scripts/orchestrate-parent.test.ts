import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DRAFT_ROADMAP, VALID_IMPL, VALID_LESSON, VALID_PLAN, VALID_TMP } from "./fixtures/persist-bodies.mjs";
import { afterEach, describe, expect, it } from "vitest";
import { probeProcess, readBootId } from "./board.mjs";
import {
  ASK_STOP_REASON,
  SESSION_GATE_STAMP,
  TMP_RESERVED_DIRS,
  hasStepAsk,
  isUnderTmp,
} from "../../.grok/hooks/orchestrate-parent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const orchParent = path.join(root, ".grok/hooks/orchestrate-parent.js");

function runHook(
  payload: unknown,
  env: NodeJS.ProcessEnv = {},
) {
  const boardHome = env.GRUNT_BOARD_HOME || fs.mkdtempSync(path.join(os.tmpdir(), "orch-board-"));
  if (!env.GRUNT_BOARD_HOME) tmpDirs.push(boardHome);
  return spawnSync(process.execPath, [orchParent], {
    encoding: "utf8",
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    cwd: root,
    env: { ...process.env, ...env, GRUNT_BOARD_HOME: boardHome },
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
  it("spawn and read allow without a top-level decision", () => {
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
    const spawnJson = spawn.stdout ? JSON.parse(spawn.stdout) : {};
    expect(spawnJson.decision).toBeUndefined();
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
    // Allow is empty stdout; a fat rewrite emits hookSpecificOutput only.
    const readJson = read.stdout ? JSON.parse(read.stdout) : {};
    expect(readJson.decision).toBeUndefined();
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

describe("persisted writes", () => {
  function pre(ws: string, toolName: string, toolInput: Record<string, unknown>) {
    const result = runHook(
      { hookEventName: "PreToolUse", toolName, toolInput, workspaceRoot: ws },
      { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: ws },
    );
    expect(result.status, result.stderr).toBe(0);
    return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null;
  }

  it("hands the host the absolute path of a new plan", () => {
    const ws = workspace();
    const out = pre(ws, "Write", { file_path: ".tmp/grunt/plans/x.md", content: VALID_PLAN });
    const saved = out.updatedInput.file_path;
    expect(path.dirname(saved)).toBe(path.join(ws, ".tmp/grunt/plans"));
    expect(path.basename(saved)).toMatch(/^1-add-tmp-ignore-\d{8}T\d{6}Z\.md$/);
    expect(fs.existsSync(saved)).toBe(true);
  });

  it("rewrites whichever path key the host sent", () => {
    const ws = workspace();
    const out = pre(ws, "write", { path: ".tmp/grunt/note.md", content: VALID_TMP });
    expect(out.updatedInput.file_path).toBeUndefined();
    expect(path.dirname(out.updatedInput.path)).toBe(path.join(ws, ".tmp/grunt"));
    expect(fs.existsSync(out.updatedInput.path)).toBe(true);
  });

  it("saves a new roadmap under .tmp/grunt/roadmaps with an absolute path", () => {
    const ws = workspace();
    const out = pre(ws, "write", { file_path: ".tmp/grunt/roadmaps/new.md", content: DRAFT_ROADMAP });
    const saved = out.updatedInput.file_path;
    expect(path.dirname(saved)).toBe(path.join(ws, ".tmp/grunt/roadmaps"));
    expect(path.basename(saved)).toMatch(/^1-auth-program-\d{8}T\d{6}Z\.md$/);
    expect(fs.existsSync(saved)).toBe(true);
  });

  it("keeps the absolute path on a full-body roadmap re-save", () => {
    const ws = workspace();
    const saved = pre(ws, "write", { file_path: ".tmp/grunt/roadmaps/new.md", content: DRAFT_ROADMAP })
      .updatedInput.file_path;
    const again = pre(ws, "write", { file_path: path.relative(ws, saved), content: DRAFT_ROADMAP });
    expect(again.updatedInput.file_path).toBe(saved);
  });

  it("leaves a write under docs/roadmaps alone", () => {
    const ws = workspace();
    expect(pre(ws, "write", { file_path: "docs/roadmaps/new.md", content: DRAFT_ROADMAP })).toBeNull();
    expect(fs.existsSync(path.join(ws, "docs/roadmaps"))).toBe(false);
  });

  it("lets a search-replace of an existing roadmap through", () => {
    const ws = workspace();
    const saved = pre(ws, "write", { file_path: ".tmp/grunt/roadmaps/new.md", content: DRAFT_ROADMAP })
      .updatedInput.file_path;
    const before = fs.readFileSync(saved, "utf8");
    const edit = pre(ws, "search_replace", {
      file_path: saved,
      old_string: "status: draft",
      new_string: "status: locked",
    });
    expect(edit).toBeNull();
    expect(fs.readFileSync(saved, "utf8")).toBe(before);
  });

  it("rewrites an existing plan in place and hands back its absolute path", () => {
    const ws = workspace();
    const saved = pre(ws, "Write", { file_path: ".tmp/grunt/plans/x.md", content: VALID_PLAN })
      .updatedInput.file_path;
    const body = fs
      .readFileSync(saved, "utf8")
      .replace("status: ready", "status: in-progress")
      .replace("reviews: 0", "reviews: 1")
      .replace("1.1 [ ]", "1.1 [x]");
    const before = fs.readFileSync(saved, "utf8");
    const again = pre(ws, "Write", { file_path: path.relative(ws, saved), content: body });
    expect(again.updatedInput.file_path).toBe(saved);
    expect(again.updatedInput.content).toMatch(/^1\.1 \[x\] /m);
    expect(fs.readdirSync(path.join(ws, ".tmp/grunt/plans"))).toEqual([path.basename(saved)]);
    // The host writes it: a hook write first makes Claude Code refuse the Write as modified since read.
    expect(fs.readFileSync(saved, "utf8")).toBe(before);
  });

  it("lets a valid Edit of an existing plan through", () => {
    const ws = workspace();
    const saved = pre(ws, "Write", { file_path: ".tmp/grunt/plans/x.md", content: VALID_PLAN })
      .updatedInput.file_path;
    const before = fs.readFileSync(saved, "utf8");
    for (const [tool, input] of [
      ["Edit", { file_path: saved, old_string: "1.1 [ ]", new_string: "1.1 [x]" }],
      ["search_replace", { file_path: saved, old_string: "1.2 [ ]", new_string: "1.2 [x]" }],
    ] as const) {
      expect(pre(ws, tool, input), tool).toBeNull();
    }
    expect(fs.readFileSync(saved, "utf8")).toBe(before);
  });

  it("denies starting an unreviewed plan by Edit and allows it after a round", () => {
    const ws = workspace();
    const saved = pre(ws, "Write", { file_path: ".tmp/grunt/plans/x.md", content: VALID_PLAN }).updatedInput.file_path;
    const flip = { file_path: saved, old_string: "status: ready", new_string: "status: in-progress" };
    const denied = pre(ws, "Edit", flip);
    expect(denied.permissionDecision).toBe("deny");
    expect(denied.permissionDecisionReason).toMatch(/\/review-plan/);
    fs.writeFileSync(saved, fs.readFileSync(saved, "utf8").replace("reviews: 0", "reviews: 1"));
    expect(pre(ws, "Edit", flip)).toBeNull();
  });

  it("denies an Edit that breaks a plan or drops a Previous mistakes entry", () => {
    const ws = workspace();
    const entry = "- review: Verify ran the whole suite → runs check-ignore only";
    const body = VALID_PLAN.replace("## Previous mistakes\n(none)", `## Previous mistakes\n${entry}`);
    const saved = pre(ws, "Write", { file_path: ".tmp/grunt/plans/x.md", content: body }).updatedInput.file_path;
    const broken = pre(ws, "Edit", { file_path: saved, old_string: "## Goal", new_string: "## Aim" });
    expect(broken.permissionDecision).toBe("deny");
    const dropped = pre(ws, "Edit", { file_path: saved, old_string: entry, new_string: "(none)" });
    expect(dropped.permissionDecision).toBe("deny");
    expect(dropped.permissionDecisionReason).toContain("Verify ran the whole suite");
  });

  it("hands the host the absolute path of a full-body journal update", () => {
    const ws = workspace();
    const saved = pre(ws, "Write", { file_path: ".tmp/grunt/implementations/x.md", content: VALID_IMPL })
      .updatedInput.file_path;
    const body = fs.readFileSync(saved, "utf8");
    const again = pre(ws, "Write", { file_path: path.relative(ws, saved), content: body });
    expect(again.updatedInput.file_path).toBe(saved);
  });
});

describe("lessons in the write hook", () => {
  function pre(ws: string, toolName: string, toolInput: Record<string, unknown>, sessionId = "s1") {
    const result = runHook(
      { hookEventName: "PreToolUse", toolName, toolInput, workspaceRoot: ws, session_id: sessionId },
      { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: ws },
    );
    expect(result.status, result.stderr).toBe(0);
    return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null;
  }

  function withSource() {
    const ws = workspace();
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "src/a.ts"), "x\n");
    fs.writeFileSync(path.join(ws, "other.ts"), "x\n");
    return ws;
  }

  function saveLesson(ws: string) {
    return pre(ws, "Write", { file_path: ".rulesync/lessons/plan-forks.md", content: VALID_LESSON });
  }

  it("hands a valid lesson to the host and regenerates the index", () => {
    const ws = withSource();
    const out = saveLesson(ws);
    expect(out.updatedInput.file_path).toBe(path.join(ws, ".rulesync/lessons/plan-forks.md"));
    expect(out.updatedInput.content).toMatch(/^hits: 1$/m);
    expect(fs.existsSync(path.join(ws, ".rulesync/lessons/plan-forks.md"))).toBe(false);
    expect(fs.readFileSync(path.join(ws, ".rulesync/lessons/INDEX.md"), "utf8")).toContain(
      "| .rulesync/lessons/plan-forks.md | src/** | 1 |",
    );
  });

  it("denies an invalid lesson with the validator reason", () => {
    const ws = withSource();
    const out = pre(ws, "Write", {
      file_path: ".rulesync/lessons/plan-forks.md",
      content: VALID_LESSON.replace('["src/**"]', '["lib/**"]'),
    });
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toMatch(/lib\/\*\* matches no file/);
  });

  it("denies an Edit of a lesson and names the routes that work", () => {
    const ws = withSource();
    saveLesson(ws);
    const out = pre(ws, "Edit", {
      file_path: path.join(ws, ".rulesync/lessons/plan-forks.md"),
      old_string: "hits: 1",
      new_string: "hits: 2",
    });
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toMatch(/Write the full lesson/);
    expect(out.permissionDecisionReason).toMatch(/lessons\.mjs hit/);
  });

  it("tells the session about a matching lesson once", () => {
    const ws = withSource();
    saveLesson(ws);
    const first = pre(ws, "Edit", { file_path: path.join(ws, "src/a.ts"), old_string: "x", new_string: "y" });
    expect(first.additionalContext).toContain(".rulesync/lessons/plan-forks.md");
    expect(first.additionalContext).toContain("Rewriting a saved plan minted a new serial.");
    expect(pre(ws, "Write", { file_path: "src/a.ts", content: "z\n" })).toBeNull();
    expect(pre(ws, "Write", { file_path: "src/a.ts", content: "z\n" }, "s2").additionalContext).toContain("plan-forks");
    expect(pre(ws, "Write", { file_path: "other.ts", content: "z\n" }, "s3")).toBeNull();
  });

  it("stays quiet without lessons and fails open on a broken index", () => {
    const ws = withSource();
    expect(pre(ws, "Write", { file_path: "src/a.ts", content: "z\n" })).toBeNull();
    fs.mkdirSync(path.join(ws, ".rulesync/lessons"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".rulesync/lessons/INDEX.md"), "| .rulesync/lessons/x.md | [ | nope |\n");
    expect(pre(ws, "Write", { file_path: "src/a.ts", content: "z\n" })).toBeNull();
  });
});

describe("isUnderTmp", () => {
  it("matches root files and rejects reserved and nested paths", () => {
    const ws = "/ws";
    expect(TMP_RESERVED_DIRS).toEqual(
      new Set(["plans", "roadmaps", "handoffs", "implementations", "browser", "orchestrator-logs", "stash", "sessions"]),
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

  it("UserPromptSubmit refreshes the row and appends other live lines", () => {
    const ws = workspace();
    const board = fs.mkdtempSync(path.join(os.tmpdir(), "orch-board-"));
    tmpDirs.push(board);
    const live = probeProcess(process.pid);
    expect(live).toBeTruthy();
    const boot = readBootId();
    const boardDir = path.join(board, ".grunt", "board");
    fs.mkdirSync(boardDir, { recursive: true });
    fs.writeFileSync(
      path.join(boardDir, "claude-other.json"),
      JSON.stringify({
        time: "2026-10-09T12:00:00Z",
        provider: "claude",
        model: "fable 51",
        effort: "medium",
        session: "other",
        cwd: "/home/user/x",
        work: "sibling live work",
        pid: live!.pid,
        start: live!.start,
        boot,
      }) + "\n",
    );
    const r = runHook(
      {
        hookEventName: "UserPromptSubmit",
        prompt: "ship the auth fix",
        workspaceRoot: ws,
        sessionId: "self",
      },
      {
        GROK_HOOK_EVENT: "user_prompt_submit",
        GROK_WORKSPACE_ROOT: ws,
        GROK_SESSION_ID: "self",
        GRUNT_BOARD_HOME: board,
        GRUNT_BOARD_PROVIDER: "claude",
      },
    );
    expect(r.status).toBe(0);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toMatch(/sessionGate=auto/);
    expect(ctx).toContain("sibling live work");
    expect(ctx).not.toContain("ship the auth fix");
    const self = JSON.parse(fs.readFileSync(path.join(boardDir, "claude-self.json"), "utf8"));
    expect(self.work).toBe("ship the auth fix");
    expect(self.session).toBe("self");
    expect(fs.existsSync(path.join(boardDir, "claude-other.json"))).toBe(true);
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
