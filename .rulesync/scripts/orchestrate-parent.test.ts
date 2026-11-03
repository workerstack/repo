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
  isSliceOf,
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

  it("claude settings do not deny Agent(orchestrator); hooks.jsonc has Stop + UserPromptSubmit", () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(root, ".claude/settings.json"), "utf8"),
    );
    expect(settings.permissions.deny).not.toContain("Agent(orchestrator)");
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

  it("validates a full-body roadmap re-save and leaves the write to the host", () => {
    const ws = workspace();
    const saved = pre(ws, "write", { file_path: ".tmp/grunt/roadmaps/new.md", content: DRAFT_ROADMAP })
      .updatedInput.file_path;
    const before = fs.readFileSync(saved, "utf8");
    const body = DRAFT_ROADMAP.replace("Every later land goes through commit.", "Every later land goes through the commit skill.");
    const again = pre(ws, "write", { file_path: path.relative(ws, saved), content: body });
    expect(again.updatedInput.file_path).toBe(saved);
    expect(again.updatedInput.content).toMatch(/through the commit skill\./);
    // The host writes it: a hook write first makes Claude Code refuse the Write as modified since read.
    expect(fs.readFileSync(saved, "utf8")).toBe(before);
  });

  it("leaves a write under docs/roadmaps alone", () => {
    const ws = workspace();
    expect(pre(ws, "write", { file_path: "docs/roadmaps/new.md", content: DRAFT_ROADMAP })).toBeNull();
    expect(fs.existsSync(path.join(ws, "docs/roadmaps"))).toBe(false);
  });

  it("checks a roadmap Edit against the text it would produce", () => {
    const ws = workspace();
    const saved = pre(ws, "write", { file_path: ".tmp/grunt/roadmaps/new.md", content: DRAFT_ROADMAP })
      .updatedInput.file_path;
    const before = fs.readFileSync(saved, "utf8");
    const broken = pre(ws, "Edit", {
      file_path: saved,
      old_string: "      Why: Every later land goes through commit.\n",
      new_string: "",
    });
    expect(broken.permissionDecision).toBe("deny");
    expect(broken.permissionDecisionReason).toMatch(/why/);
    for (const [tool, input] of [
      ["Edit", { file_path: saved, old_string: "1 [ ] Title", new_string: "1 [x] Title" }],
      ["search_replace", { file_path: saved, old_string: "3.1 [ ]", new_string: "3.1 [x]" }],
    ] as const) {
      expect(pre(ws, tool, input), tool).toBeNull();
    }
    expect(fs.readFileSync(saved, "utf8")).toBe(before);
  });

  it("denies locking an unreviewed roadmap by Edit and allows it after a round", () => {
    const ws = workspace();
    const saved = pre(ws, "write", { file_path: ".tmp/grunt/roadmaps/new.md", content: DRAFT_ROADMAP })
      .updatedInput.file_path;
    const lock = { file_path: saved, old_string: "status: draft", new_string: "status: locked" };
    const denied = pre(ws, "Edit", lock);
    expect(denied.permissionDecision).toBe("deny");
    expect(denied.permissionDecisionReason).toMatch(/\/review-roadmap/);
    fs.writeFileSync(saved, fs.readFileSync(saved, "utf8").replace("reviews: 0", "reviews: 1"));
    expect(pre(ws, "Edit", lock)).toBeNull();
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

describe("y approval trigger", () => {
  const env = (ws: string) => ({ CLAUDE_PROJECT_DIR: ws });
  function hook(ws: string, payload: Record<string, unknown>) {
    const result = runHook({ cwd: ws, ...payload }, env(ws));
    expect(result.status, result.stderr).toBe(0);
    return result.stdout ? JSON.parse(result.stdout) : null;
  }
  const prompt = (ws: string, sid: string, text: string, extra: Record<string, unknown> = {}) =>
    hook(ws, { hook_event_name: "UserPromptSubmit", session_id: sid, prompt: text, ...extra });
  const stopWith = (ws: string, sid: string, msg: string) =>
    hook(ws, { hook_event_name: "Stop", session_id: sid, last_assistant_message: msg });
  function write(ws: string, sid: string, file: string, content: string) {
    const out = hook(ws, {
      hook_event_name: "PreToolUse",
      session_id: sid,
      tool_name: "Write",
      tool_input: { file_path: file, content },
    });
    const saved = out.hookSpecificOutput.updatedInput.file_path;
    fs.writeFileSync(saved, out.hookSpecificOutput.updatedInput.content);
    return saved as string;
  }
  // A new save, then the review-bump re-save, as /write-plan does it.
  function reviewed(ws: string, sid: string, dir: "plans" | "roadmaps", body: string) {
    const saved = write(ws, sid, `.tmp/grunt/${dir}/x.md`, body);
    write(ws, sid, saved, fs.readFileSync(saved, "utf8").replace("reviews: 0", "reviews: 1"));
    return saved;
  }
  const approvals = (ws: string, sid: string) =>
    fs.readFileSync(path.join(ws, ".tmp/grunt/sessions", sid, "approvals.txt"), "utf8").trim().split("\n");
  function transcript(ws: string, text: string) {
    const file = path.join(ws, "transcript.jsonl");
    const rec = (role: string, t: string) =>
      JSON.stringify({ type: role, message: { role, content: [{ type: "text", text: t }] } });
    fs.writeFileSync(file, [rec("user", "write the plan"), rec("assistant", text)].join("\n") + "\n");
    return file;
  }

  it("records the saved path of each plan and roadmap save, Claude and Grok shapes", () => {
    const ws = workspace();
    prompt(ws, "s1", "plan it");
    const plan = reviewed(ws, "s1", "plans", VALID_PLAN);
    expect(path.basename(plan)).toMatch(/^1-add-tmp-ignore-/);
    const grok = runHook(
      {
        hookEventName: "PreToolUse",
        toolName: "write",
        toolInput: { path: ".tmp/grunt/roadmaps/y.md", content: DRAFT_ROADMAP },
        workspaceRoot: ws,
        sessionId: "s1",
      },
      { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: "s1" },
    );
    const roadmap = JSON.parse(grok.stdout).hookSpecificOutput.updatedInput.path;
    expect(approvals(ws, "s1")).toEqual([plan, roadmap]);
  });

  it("blocks once per turn until the reply ends with the closing line naming every pending item", () => {
    const ws = workspace();
    prompt(ws, "s2", "plan it");
    reviewed(ws, "s2", "plans", VALID_PLAN);
    const ask = stopWith(ws, "s2", "Plan 1 is saved.\nShall I start?");
    expect(ask).toEqual({ decision: "block", reason: 'end with: Reply "y" to run plan 1.' });
    const grokAgain = runHook(
      { hookEventName: "Stop", reason: "end_turn", lastAssistantMessage: "Shall I start?", workspaceRoot: ws, sessionId: "s2" },
      { GROK_HOOK_EVENT: "stop", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: "s2" },
    );
    expect(grokAgain.stdout).toBe("");

    prompt(ws, "s2", "more");
    reviewed(ws, "s2", "plans", VALID_PLAN);
    expect(stopWith(ws, "s2", 'Plan 2 is saved.\n\n**Reply "y" to run plan 1, then plan 2.**')).toBeNull();

    prompt(ws, "s2", "and a roadmap");
    reviewed(ws, "s2", "plans", VALID_PLAN);
    reviewed(ws, "s2", "roadmaps", DRAFT_ROADMAP);
    expect(stopWith(ws, "s2", "Saved.")?.reason).toBe(
      'end with: Reply "y" to run plan 1, then plan 2, then plan 3, then roadmap 1.',
    );
    prompt(ws, "s2", "again");
    reviewed(ws, "s2", "plans", VALID_PLAN);
    expect(stopWith(ws, "s2", 'Reply "y" to run plan 1.')?.decision).toBe("block");
    prompt(ws, "s2", "again");
    reviewed(ws, "s2", "plans", VALID_PLAN);
    expect(stopWith(ws, "s2", 'Reply "y" to run plan 5, then plan 9.')?.decision).toBe("block");
  });

  it("does not block on earlier turns, roadmap child plans, missing turn stamps or a missing session", () => {
    const ws = workspace();
    prompt(ws, "s3", "plan it");
    const plan = reviewed(ws, "s3", "plans", VALID_PLAN);
    prompt(ws, "s3", "something else");
    expect(stopWith(ws, "s3", "Done.")).toBeNull();

    const child = workspace();
    prompt(child, "s4", "run the roadmap");
    const childPlan = reviewed(child, "s4", "plans", VALID_PLAN);
    fs.mkdirSync(path.join(child, ".tmp/grunt/roadmaps"), { recursive: true });
    fs.writeFileSync(
      path.join(child, ".tmp/grunt/roadmaps/1-auth-program-20261103T000000Z.md"),
      `---\nserial: 1\nname: auth-program\nstatus: in-progress\nreviews: 1\n---\n\n## Order\n1 [ ] Title: auth types\n      Location: ${childPlan}\n`,
    );
    expect(stopWith(child, "s4", "Wrote plan 1.")).toBeNull();
    expect(
      isSliceOf(
        "c:/Users/me/repo/.tmp/grunt/plans/1-x.md",
        "1 [ ] Title: t\n      Location: C:\\Users\\me\\repo\\.tmp\\grunt\\plans\\1-x.md\n",
        path.win32,
      ),
    ).toBe(true);
    expect(isSliceOf("/r/.tmp/grunt/plans/2-x.md", "      Location: /r/.tmp/grunt/plans/1-x.md\n", path.posix)).toBe(false);

    const noTurn = workspace();
    reviewed(noTurn, "s5", "plans", VALID_PLAN);
    expect(stopWith(noTurn, "s5", "Done.")).toBeNull();

    const noSid = workspace();
    hook(noSid, { hook_event_name: "UserPromptSubmit", prompt: "plan it" });
    const saved = write(noSid, "", ".tmp/grunt/plans/x.md", VALID_PLAN);
    write(noSid, "", saved, fs.readFileSync(saved, "utf8").replace("reviews: 0", "reviews: 1"));
    expect(fs.existsSync(path.join(noSid, ".tmp/grunt/sessions"))).toBe(false);
    expect(hook(noSid, { hook_event_name: "Stop", last_assistant_message: "Done." })).toBeNull();
    expect(plan).toBeTruthy();
  });

  it("y approves exactly what the closing line names", () => {
    const ws = workspace();
    prompt(ws, "s6", "plan it");
    const plan = reviewed(ws, "s6", "plans", VALID_PLAN);
    prompt(ws, "s6", "and a roadmap");
    const roadmap = reviewed(ws, "s6", "roadmaps", DRAFT_ROADMAP);
    const tp = transcript(ws, 'Both saved.\n\nReply "y" to run plan 1, then roadmap 1.');
    const ctx = (text: string, extra: Record<string, unknown> = { transcript_path: tp }) =>
      prompt(ws, "s6", text, extra)?.hookSpecificOutput?.additionalContext ?? "";
    for (const text of ["y", "Y "]) {
      const out = ctx(text);
      expect(out).toContain(`y approves plan 1, then roadmap 1: plan 1: run /implement-plan 1 (${plan})`);
      expect(out).toContain(`roadmap 1: set status locked, then run /implement-roadmap 1 (${roadmap})`);
    }
    expect(ctx("yes do it")).not.toContain("y approves");
    expect(ctx("y", { transcript_path: transcript(ws, "Plan 1 is saved. Start?") })).not.toContain("y approves");
    expect(ctx("y", { transcript_path: transcript(ws, 'Reply "y" to run plan 7.') })).not.toContain("y approves");
    expect(ctx("y", {})).not.toContain("y approves");
  });

  it("under /ask the closing line counts as the step ask", () => {
    const ws = workspace();
    prompt(ws, "s7", "/ask");
    expect(stopWith(ws, "s7", 'Saved.\n\nReply "y" to run plan 3.')).toBeNull();
    expect(stopWith(ws, "s7", "Saved plan 3.")?.reason).toBe(ASK_STOP_REASON);
  });
});
