import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DRAFT_ROADMAP, VALID_IMPL, VALID_LESSON, VALID_PLAN, VALID_TMP } from "./fixtures/persist-bodies.mjs";
import { afterEach, describe, expect, it } from "vitest";
import { aliasOf } from "../../dev/test-paths";
import { probeProcess, readBootId } from "./board.mjs";
import { persistLesson } from "./lessons.mjs";
import { TMP_RESERVED_DIRS, isUnderTmp } from "./persist-tmp.mjs";
import { validatePlan } from "./persist-plan.mjs";
import { validateRoadmap } from "./persist-roadmap.mjs";
import { closingLine, parseClosingLine, stampPath } from "./strategy.mjs";
import {
  ASK_STOP_REASON,
  SESSION_GATE_STAMP,
  hasStepAsk,
  isSliceOf,
} from "../../.grok/hooks/orchestrate-parent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const orchParent = path.join(root, ".grok/hooks/orchestrate-parent.js");

function runHook(
  payload: unknown,
  env: NodeJS.ProcessEnv = {},
) {
  const boardHome = env.REPO_BOARD_HOME || fs.mkdtempSync(path.join(os.tmpdir(), "orch-board-"));
  if (!env.REPO_BOARD_HOME) tmpDirs.push(boardHome);
  return spawnSync(process.execPath, [orchParent], {
    encoding: "utf8",
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    cwd: root,
    env: { ...process.env, ...env, REPO_BOARD_HOME: boardHome },
    timeout: 10_000,
  });
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(`${d}-alias`, { force: true });
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
        subagentType: "scout",
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
          subagentType: "scout",
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
        subagentType: "scout",
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
        subagentType: "scout",
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
          subagent_type: "scout",
          resume_from: "child-1",
          prompt: "You are scout subagent. ship it",
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
        subagentType: "scout",
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
        subagentType: "scout",
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
        subagentType: "scout",
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
    const out = pre(ws, "Write", { file_path: ".tmp/repo/plans/x.md", content: VALID_PLAN });
    const saved = out.updatedInput.file_path;
    expect(path.dirname(saved)).toBe(path.join(ws, ".tmp/repo/plans"));
    expect(path.basename(saved)).toMatch(/^1-add-tmp-ignore-\d{8}T\d{6}Z\.md$/);
    expect(fs.existsSync(saved)).toBe(true);
  });

  it("rewrites whichever path key the host sent", () => {
    const ws = workspace();
    const out = pre(ws, "write", { path: ".tmp/repo/note.md", content: VALID_TMP });
    expect(out.updatedInput.file_path).toBeUndefined();
    expect(path.dirname(out.updatedInput.path)).toBe(path.join(ws, ".tmp/repo"));
    expect(fs.existsSync(out.updatedInput.path)).toBe(true);
  });

  it("saves a new roadmap under .tmp/repo/roadmaps with an absolute path", () => {
    const ws = workspace();
    const out = pre(ws, "write", { file_path: ".tmp/repo/roadmaps/new.md", content: DRAFT_ROADMAP });
    const saved = out.updatedInput.file_path;
    expect(path.dirname(saved)).toBe(path.join(ws, ".tmp/repo/roadmaps"));
    expect(path.basename(saved)).toMatch(/^1-auth-program-\d{8}T\d{6}Z\.md$/);
    expect(fs.existsSync(saved)).toBe(true);
  });

  it("validates a full-body roadmap re-save and leaves the write to the host", () => {
    const ws = workspace();
    const saved = pre(ws, "write", { file_path: ".tmp/repo/roadmaps/new.md", content: DRAFT_ROADMAP })
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
    const saved = pre(ws, "write", { file_path: ".tmp/repo/roadmaps/new.md", content: DRAFT_ROADMAP })
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
    const saved = pre(ws, "write", { file_path: ".tmp/repo/roadmaps/new.md", content: DRAFT_ROADMAP })
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
    const saved = pre(ws, "Write", { file_path: ".tmp/repo/plans/x.md", content: VALID_PLAN })
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
    expect(fs.readdirSync(path.join(ws, ".tmp/repo/plans"))).toEqual([path.basename(saved)]);
    // The host writes it: a hook write first makes Claude Code refuse the Write as modified since read.
    expect(fs.readFileSync(saved, "utf8")).toBe(before);
  });

  it("lets a valid Edit of an existing plan through", () => {
    const ws = workspace();
    const saved = pre(ws, "Write", { file_path: ".tmp/repo/plans/x.md", content: VALID_PLAN })
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
    const saved = pre(ws, "Write", { file_path: ".tmp/repo/plans/x.md", content: VALID_PLAN }).updatedInput.file_path;
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
    const saved = pre(ws, "Write", { file_path: ".tmp/repo/plans/x.md", content: body }).updatedInput.file_path;
    const broken = pre(ws, "Edit", { file_path: saved, old_string: "## Goal", new_string: "## Aim" });
    expect(broken.permissionDecision).toBe("deny");
    const dropped = pre(ws, "Edit", { file_path: saved, old_string: entry, new_string: "(none)" });
    expect(dropped.permissionDecision).toBe("deny");
    expect(dropped.permissionDecisionReason).toContain("Verify ran the whole suite");
  });

  it("hands the host the absolute path of a full-body journal update", () => {
    const ws = workspace();
    const saved = pre(ws, "Write", { file_path: ".tmp/repo/implementations/x.md", content: VALID_IMPL })
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
      new Set([
        "plans",
        "roadmaps",
        "handoffs",
        "implementations",
        "browser",
        "orchestrator-logs",
        "stash",
        "sessions",
        "listen",
        "speak",
      ]),
    );
    expect(isUnderTmp(".tmp/repo/notes.md", ws)).toBe(true);
    expect(isUnderTmp(path.join(ws, ".tmp/repo/1-x-20260827T143000Z.md"), ws)).toBe(
      true,
    );
    expect(isUnderTmp(".tmp/repo/tmp/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/repo/browser/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/repo/orchestrator-logs/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/repo/cov/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/repo/plans/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/repo/handoffs/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/repo/implementations/x.md", ws)).toBe(false);
    expect(isUnderTmp(".tmp/repo/plans", ws)).toBe(false);
    expect(isUnderTmp(".tmp/repo/handoffs", ws)).toBe(false);
    expect(isUnderTmp(".tmp/repo/implementations", ws)).toBe(false);
    expect(isUnderTmp(".tmp/repo/browser", ws)).toBe(false);
    expect(isUnderTmp(".tmp/repo/orchestrator-logs", ws)).toBe(false);
  });
});

describe("sessionGate /auto /ask", () => {
  function stampAbs(ws: string, sid: string) {
    return path.join(ws, ".tmp/repo/orchestrator-logs", `${SESSION_GATE_STAMP}-${sid}`);
  }

  it("hasStepAsk is true on a question; wait-scout is exact", () => {
    expect(hasStepAsk("wrote src/a.ts\nContinue?")).toBe(true);
    expect(hasStepAsk("wrote src/a.ts")).toBe(false);
    expect(hasStepAsk("[orchestrator]: wait scout")).toBe(true);
  });

  it("UserPromptSubmit refreshes the row and appends other live lines", () => {
    const ws = workspace();
    const board = fs.mkdtempSync(path.join(os.tmpdir(), "orch-board-"));
    tmpDirs.push(board);
    const live = probeProcess(process.pid);
    expect(live).toBeTruthy();
    const boot = readBootId();
    const boardDir = path.join(board, ".workerstack", "board");
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
        REPO_BOARD_HOME: board,
        REPO_BOARD_PROVIDER: "claude",
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
    expect(fs.existsSync(path.join(ws, ".tmp/repo/orchestrator-logs"))).toBe(false);
  });

  it("ask Stop without a question blocks; with a question or wait-scout allows; auto allows", () => {
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
        lastAssistantMessage: "[orchestrator]: wait scout",
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
    const saved = write(ws, sid, `.tmp/repo/${dir}/x.md`, body);
    write(ws, sid, saved, fs.readFileSync(saved, "utf8").replace("reviews: 0", "reviews: 1"));
    return saved;
  }
  const approvals = (ws: string, sid: string) =>
    fs.readFileSync(path.join(ws, ".tmp/repo/sessions", sid, "approvals.txt"), "utf8").trim().split("\n");
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
        toolInput: { path: ".tmp/repo/roadmaps/y.md", content: DRAFT_ROADMAP },
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
    expect(ask).toEqual({
      decision: "block",
      reason: `end with: ${closingLine([{ kind: "plan", serial: 1, strategy: "default" }])}`,
    });
    expect(ask?.reason).toBe(
      'end with: Reply "y" to run plan 1 (strategy: default), or "y review-fast" / "y review-deep".',
    );
    const grokAgain = runHook(
      { hookEventName: "Stop", reason: "end_turn", lastAssistantMessage: "Shall I start?", workspaceRoot: ws, sessionId: "s2" },
      { GROK_HOOK_EVENT: "stop", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: "s2" },
    );
    expect(grokAgain.stdout).toBe("");

    prompt(ws, "s2", "more");
    reviewed(ws, "s2", "plans", VALID_PLAN);
    expect(
      stopWith(
        ws,
        "s2",
        'Plan 2 is saved.\n\n**Reply "y" to run plan 1 (strategy: default), then plan 2 (strategy: default), or "y review-fast" / "y review-deep".**',
      ),
    ).toBeNull();

    prompt(ws, "s2", "and a roadmap");
    reviewed(ws, "s2", "plans", VALID_PLAN);
    reviewed(ws, "s2", "roadmaps", DRAFT_ROADMAP);
    expect(stopWith(ws, "s2", "Saved.")?.reason).toBe(
      'end with: Reply "y" to run plan 1 (strategy: default), then plan 2 (strategy: default), then plan 3 (strategy: default), then roadmap 1 (strategy: default), or "y review-fast" / "y review-deep".',
    );
    prompt(ws, "s2", "again");
    reviewed(ws, "s2", "plans", VALID_PLAN);
    expect(stopWith(ws, "s2", 'Reply "y" to run plan 1.')?.decision).toBe("block");
    prompt(ws, "s2", "again");
    reviewed(ws, "s2", "plans", VALID_PLAN);
    expect(
      stopWith(ws, "s2", 'Reply "y" to run plan 5 (strategy: default), then plan 9 (strategy: default), or "y review-fast" / "y review-deep".')
        ?.decision,
    ).toBe("block");
  });

  it("does not take the old closing line for an ask, in any markdown wrapping", () => {
    const ws = workspace();
    prompt(ws, "old", "plan it");
    reviewed(ws, "old", "plans", VALID_PLAN);
    for (const old of ['Reply "y" to run plan 1.', '**Reply "y" to run plan 1.**', '`Reply "y" to run plan 1.`']) {
      expect(parseClosingLine(old)).toBeNull();
      expect(stopWith(ws, "old", `Saved.\n\n${old}`)?.decision).toBe("block");
      prompt(ws, "old", "again");
      reviewed(ws, "old", "plans", VALID_PLAN);
    }
  });

  it("blocks when the line shows a strategy the file does not hold, and names the line the files render", () => {
    const ws = workspace();
    prompt(ws, "mis", "plan it");
    reviewed(ws, "mis", "plans", VALID_PLAN.replace("strategy: default", "strategy: review-fast"));
    const shown = 'Saved.\n\nReply "y" to run plan 1 (strategy: default), or "y review-fast" / "y review-deep".';
    expect(parseClosingLine(shown.split("\n").at(-1)!)).not.toBeNull();
    expect(stopWith(ws, "mis", shown)).toEqual({
      decision: "block",
      reason: 'end with: Reply "y" to run plan 1 (strategy: review-fast), or "y default" / "y review-deep".',
    });
    prompt(ws, "mis", "again");
    reviewed(ws, "mis", "plans", VALID_PLAN.replace("strategy: default", "strategy: review-fast"));
    expect(
      stopWith(
        ws,
        "mis",
        'Reply "y" to run plan 1 (strategy: review-fast), then plan 2 (strategy: review-fast), or "y default" / "y review-deep".',
      ),
    ).toBeNull();
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
    fs.mkdirSync(path.join(child, ".tmp/repo/roadmaps"), { recursive: true });
    fs.writeFileSync(
      path.join(child, ".tmp/repo/roadmaps/1-auth-program-20261103T000000Z.md"),
      `---\nserial: 1\nname: auth-program\nstatus: in-progress\nreviews: 1\nstrategy: default\n---\n\n## Order\n1 [ ] Title: auth types\n      Location: ${childPlan}\n`,
    );
    expect(stopWith(child, "s4", "Wrote plan 1.")).toBeNull();
    expect(
      isSliceOf(
        "c:/Users/me/repo/.tmp/repo/plans/1-x.md",
        "1 [ ] Title: t\n      Location: C:\\Users\\me\\repo\\.tmp\\repo\\plans\\1-x.md\n",
        path.win32,
      ),
    ).toBe(true);
    expect(isSliceOf("/r/.tmp/repo/plans/2-x.md", "      Location: /r/.tmp/repo/plans/1-x.md\n", path.posix)).toBe(false);

    const noTurn = workspace();
    reviewed(noTurn, "s5", "plans", VALID_PLAN);
    expect(stopWith(noTurn, "s5", "Done.")).toBeNull();

    const noSid = workspace();
    hook(noSid, { hook_event_name: "UserPromptSubmit", prompt: "plan it" });
    const saved = write(noSid, "", ".tmp/repo/plans/x.md", VALID_PLAN);
    write(noSid, "", saved, fs.readFileSync(saved, "utf8").replace("reviews: 0", "reviews: 1"));
    expect(fs.existsSync(path.join(noSid, ".tmp/repo/sessions"))).toBe(false);
    expect(hook(noSid, { hook_event_name: "Stop", last_assistant_message: "Done." })).toBeNull();
    expect(plan).toBeTruthy();
  });

  describe("a reply of y", () => {
    const withStrategy = (s: string) => VALID_PLAN.replace("strategy: default", `strategy: ${s}`);
    const roadmapWith = (s: string) => DRAFT_ROADMAP.replace("strategy: default", `strategy: ${s}`);
    const ctxOf = (ws: string, sid: string, text: string, tp?: string) =>
      (prompt(ws, sid, text, tp ? { transcript_path: tp } : {})?.hookSpecificOutput?.additionalContext ?? "") as string;
    const lines = (s: string) => s.split("\n");
    const strategyOf = (file: string) => /^strategy: (.*)$/m.exec(fs.readFileSync(file, "utf8"))![1];

    it("approves exactly what the closing line names, and leaves the file's bytes and strategy alone", () => {
      const ws = workspace();
      prompt(ws, "s6", "plan it");
      const plan = reviewed(ws, "s6", "plans", VALID_PLAN);
      prompt(ws, "s6", "and a roadmap");
      const roadmap = reviewed(ws, "s6", "roadmaps", DRAFT_ROADMAP);
      const before = [plan, roadmap].map((f) => fs.readFileSync(f, "utf8"));
      const tp = transcript(
        ws,
        'Both saved.\n\nReply "y" to run plan 1 (strategy: default), then roadmap 1 (strategy: default), or "y review-fast" / "y review-deep".',
      );
      for (const text of ["y", "Y "]) {
        const out = ctxOf(ws, "s6", text, tp);
        expect(lines(out)).toContain(
          `y approves plan 1, then roadmap 1: plan 1: run /implement-plan 1 (${plan}); roadmap 1: set status locked, then run /implement-roadmap 1 (${roadmap})`,
        );
      }
      expect([plan, roadmap].map((f) => fs.readFileSync(f, "utf8"))).toEqual(before);
      expect(ctxOf(ws, "s6", "yes do it", tp)).not.toContain("y approves");
      expect(ctxOf(ws, "s6", "y", transcript(ws, "Plan 1 is saved. Start?"))).not.toContain("y approves");
      expect(ctxOf(ws, "s6", "y", transcript(ws, 'Reply "y" to run plan 1.'))).not.toContain("y approves");
      expect(
        ctxOf(ws, "s6", "y", transcript(ws, 'Reply "y" to run plan 7 (strategy: default), or "y review-fast" / "y review-deep".')),
      ).not.toContain("y approves");
      expect(ctxOf(ws, "s6", "y")).not.toContain("y approves");
    });

    it("on a default plan the context is today's, byte for byte", () => {
      const ws = workspace();
      prompt(ws, "d1", "plan it");
      const plan = reviewed(ws, "d1", "plans", VALID_PLAN);
      const tp = transcript(ws, 'Saved.\n\nReply "y" to run plan 1 (strategy: default), or "y review-fast" / "y review-deep".');
      expect(lines(ctxOf(ws, "d1", "y", tp))).toContain(`y approves plan 1: plan 1: run /implement-plan 1 (${plan})`);
    });

    it("a bare y does not approve a line whose strategy differs from the file's", () => {
      const ws = workspace();
      prompt(ws, "d2", "plan it");
      const plan = reviewed(ws, "d2", "plans", withStrategy("review-fast"));
      const shown = transcript(ws, 'Saved.\n\nReply "y" to run plan 1 (strategy: default), or "y review-fast" / "y review-deep".');
      expect(ctxOf(ws, "d2", "y", shown)).not.toContain("y approves");
      const truthful = transcript(ws, 'Saved.\n\nReply "y" to run plan 1 (strategy: review-fast), or "y default" / "y review-deep".');
      expect(ctxOf(ws, "d2", "y", truthful)).toContain(`plan 1: run /implement-plan 1 (${plan})`);
      expect(strategyOf(plan)).toBe("review-fast");
    });

    it("y review-deep writes the strategy into the plan, tells the agent to re-read, and a second one changes no bytes", () => {
      const ws = workspace();
      prompt(ws, "r1", "plan it");
      const plan = reviewed(ws, "r1", "plans", VALID_PLAN);
      const before = fs.readFileSync(plan, "utf8");
      const tp = transcript(ws, 'Saved.\n\nReply "y" to run plan 1 (strategy: default), or "y review-fast" / "y review-deep".');
      const want = `y approves plan 1: plan 1: strategy review-deep was written to its frontmatter; re-read the plan, then run /implement-plan 1 (${plan})`;
      expect(lines(ctxOf(ws, "r1", "y review-deep", tp))).toContain(want);
      const after = fs.readFileSync(plan, "utf8");
      expect(after).toBe(before.replace("strategy: default", "strategy: review-deep"));
      expect(validatePlan(path.basename(plan), after, { fresh: false, previous: before })).toEqual([]);
      const mtime = fs.statSync(plan).mtimeMs;
      // Nothing left to write: the context is the plain approval, with no claim of a change.
      expect(lines(ctxOf(ws, "r1", "Y  Review-Deep ", tp))).toContain(
        `y approves plan 1: plan 1: run /implement-plan 1 (${plan})`,
      );
      expect(fs.readFileSync(plan, "utf8")).toBe(after);
      expect(fs.statSync(plan).mtimeMs).toBe(mtime);
    });

    it("y default rewrites every item of a queue, a plan and a roadmap", () => {
      const ws = workspace();
      prompt(ws, "r2", "plan it");
      const p1 = reviewed(ws, "r2", "plans", withStrategy("review-fast"));
      const p2 = reviewed(ws, "r2", "plans", withStrategy("review-deep"));
      const rm = reviewed(ws, "r2", "roadmaps", roadmapWith("review-fast"));
      const tp = transcript(
        ws,
        'Saved.\n\nReply "y" to run plan 1 (strategy: review-fast), then plan 2 (strategy: review-deep), then roadmap 1 (strategy: review-fast), or "y default" / "y review-fast" / "y review-deep".',
      );
      const out = ctxOf(ws, "r2", "y default", tp);
      expect(out).toContain(
        `y approves plan 1, then plan 2, then roadmap 1: plan 1: strategy default was written to its frontmatter; re-read the plan, then run /implement-plan 1 (${p1}); plan 2: strategy default was written to its frontmatter; re-read the plan, then run /implement-plan 2 (${p2}); roadmap 1: strategy default was written to its frontmatter; re-read the roadmap, then set status locked, then run /implement-roadmap 1 (${rm})`,
      );
      for (const f of [p1, p2, rm]) expect(strategyOf(f)).toBe("default");
      const rmText = fs.readFileSync(rm, "utf8");
      expect(validateRoadmap(path.basename(rm), rmText, { fresh: false, previous: rmText })).toEqual([]);
      ctxOf(ws, "r2", "y default", tp);
      expect(fs.readFileSync(rm, "utf8")).toBe(rmText);
    });

    it("y with a Grok payload writes the strategy too", () => {
      const ws = workspace();
      prompt(ws, "g1", "plan it");
      const plan = reviewed(ws, "g1", "plans", VALID_PLAN);
      const tp = transcript(ws, 'Saved.\n\nReply "y" to run plan 1 (strategy: default), or "y review-fast" / "y review-deep".');
      const out = runHook(
        { hookEventName: "UserPromptSubmit", prompt: "y review-fast", transcriptPath: tp, workspaceRoot: ws, sessionId: "g1" },
        { GROK_HOOK_EVENT: "user_prompt_submit", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: "g1" },
      );
      expect(out.status, out.stderr).toBe(0);
      expect(JSON.parse(out.stdout).hookSpecificOutput.additionalContext).toContain(
        `strategy review-fast was written to its frontmatter; re-read the plan, then run /implement-plan 1 (${plan})`,
      );
      expect(strategyOf(plan)).toBe("review-fast");
    });

    it("y review-medium approves nothing and names the valid replies", () => {
      const ws = workspace();
      prompt(ws, "u1", "plan it");
      const plan = reviewed(ws, "u1", "plans", VALID_PLAN);
      const before = fs.readFileSync(plan, "utf8");
      const tp = transcript(ws, 'Saved.\n\nReply "y" to run plan 1 (strategy: default), or "y review-fast" / "y review-deep".');
      const out = ctxOf(ws, "u1", "y review-medium", tp);
      expect(lines(out)).toContain('unknown strategy "review-medium"; use y, y default, y review-fast or y review-deep');
      expect(out).not.toContain("y approves");
      expect(fs.readFileSync(plan, "utf8")).toBe(before);
    });

    it("an invalid result is never written", () => {
      const ws = workspace();
      prompt(ws, "e1", "plan it");
      const plan = reviewed(ws, "e1", "plans", VALID_PLAN);
      const tp = transcript(ws, 'Saved.\n\nReply "y" to run plan 1 (strategy: default), or "y review-fast" / "y review-deep".');
      fs.writeFileSync(plan, fs.readFileSync(plan, "utf8").replace("## Goal", "## Aim"));
      const before = fs.readFileSync(plan, "utf8");
      const out = ctxOf(ws, "e1", "y review-deep", tp);
      expect(out).toContain("y did not approve plan 1: strategy review-deep could not be written");
      expect(out).not.toContain("y approves");
      expect(fs.readFileSync(plan, "utf8")).toBe(before);
    });
  });

  it("under /ask the closing line counts as the step ask", () => {
    const ws = workspace();
    prompt(ws, "s7", "/ask");
    expect(
      stopWith(ws, "s7", 'Saved.\n\nReply "y" to run plan 3 (strategy: default), or "y review-fast" / "y review-deep".'),
    ).toBeNull();
    expect(stopWith(ws, "s7", 'Saved.\n\nReply "y" to run plan 3.')?.reason).toBe(ASK_STOP_REASON);
    expect(stopWith(ws, "s7", "Saved plan 3.")?.reason).toBe(ASK_STOP_REASON);
  });
});

describe("one scratch root from subdirs and worktrees", () => {
  function gitRepo() {
    const r = fs.realpathSync(workspace());
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
  const writePlan = (file: string, cwd: string, env: NodeJS.ProcessEnv, sid: string, content = VALID_PLAN) =>
    runHook({ hook_event_name: "PreToolUse", session_id: sid, cwd, tool_name: "Write", tool_input: { file_path: file, content } }, env);

  it("saves a plan aimed at a subdir's .tmp/repo at the root, with its approval", () => {
    const { r } = gitRepo();
    const a = path.join(r, "packages/a");
    const out = writePlan(path.join(a, ".tmp/repo/plans/x.md"), a, {}, "s1");
    expect(out.status, out.stderr).toBe(0);
    const saved = JSON.parse(out.stdout).hookSpecificOutput.updatedInput.file_path;
    expect(path.dirname(saved)).toBe(path.join(r, ".tmp/repo/plans"));
    expect(fs.readFileSync(path.join(r, ".tmp/repo/sessions/s1/approvals.txt"), "utf8")).toContain(saved);
    expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
  });

  it("saves a worktree session's plan at the main checkout", () => {
    const { r, w } = gitRepo();
    const out = writePlan(path.join(w, ".tmp/repo/plans/x.md"), w, { CLAUDE_PROJECT_DIR: w }, "s2");
    expect(out.status, out.stderr).toBe(0);
    const saved = JSON.parse(out.stdout).hookSpecificOutput.updatedInput.file_path;
    expect(path.dirname(saved)).toBe(path.join(r, ".tmp/repo/plans"));
    expect(fs.existsSync(path.join(w, ".tmp"))).toBe(false);
  });

  it("checks a worktree plan's lesson citations against the worktree's lessons", () => {
    const { w } = gitRepo();
    fs.mkdirSync(path.join(w, "src"), { recursive: true });
    fs.writeFileSync(path.join(w, "src/a.ts"), "x\n");
    const lesson = path.join(w, ".rulesync/lessons/plan-forks.md");
    const rendered = persistLesson({ workspaceRoot: w, filePath: lesson, content: VALID_LESSON });
    expect(rendered.ok, rendered.error).toBe(true);
    fs.writeFileSync(lesson, rendered.content!);
    const touching = VALID_PLAN.replace("1.1 [ ] read the gitignore if it exists", `1.1 [ ] edit ${path.join(w, "src/a.ts")}`);
    const out = writePlan(path.join(w, ".tmp/repo/plans/x.md"), w, { CLAUDE_PROJECT_DIR: w }, "s3", touching);
    expect(out.status, out.stderr).toBe(0);
    const res = JSON.parse(out.stdout).hookSpecificOutput;
    expect(res.permissionDecision).toBe("deny");
    expect(res.permissionDecisionReason).toContain(".rulesync/lessons/plan-forks.md");
  });

  it("saves, checks and notices through an alias of the repo as through its real path", () => {
    const { r, w } = gitRepo();
    const alias = aliasOf(r);
    fs.mkdirSync(path.join(w, "src"), { recursive: true });
    fs.writeFileSync(path.join(w, "src/a.ts"), "x\n");
    const saved = writePlan(path.join(alias, ".tmp/repo/plans/x.md"), alias, { CLAUDE_PROJECT_DIR: alias }, "s5");
    expect(saved.status, saved.stderr).toBe(0);
    const file = JSON.parse(saved.stdout).hookSpecificOutput.updatedInput.file_path;
    expect(path.dirname(file)).toBe(path.join(r, ".tmp/repo/plans"));
    expect(fs.readFileSync(path.join(r, ".tmp/repo/sessions/s5/approvals.txt"), "utf8")).toContain(file);

    // The lesson lives in the worktree that holds the file; the main checkout takes no lesson writes.
    const lesson = path.join(w, ".rulesync/lessons/plan-forks.md");
    const rendered = persistLesson({ workspaceRoot: w, filePath: lesson, content: VALID_LESSON });
    expect(rendered.ok, rendered.error).toBe(true);
    fs.writeFileSync(lesson, rendered.content!);
    const viaAlias = path.join(alias, ".worktrees/w/src/a.ts");
    const touching = VALID_PLAN.replace("1.1 [ ] read the gitignore if it exists", `1.1 [ ] edit ${viaAlias}`);
    const cited = JSON.parse(writePlan(path.join(alias, ".tmp/repo/plans/y.md"), alias, { CLAUDE_PROJECT_DIR: alias }, "s5", touching).stdout);
    expect(cited.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(cited.hookSpecificOutput.permissionDecisionReason).toContain(".rulesync/lessons/plan-forks.md");

    const notice = writePlan(viaAlias, alias, { CLAUDE_PROJECT_DIR: alias }, "s6", "y\n");
    expect(notice.stdout).toContain("Recorded lessons match src/a.ts");
  });

  it("notices the lessons of the worktree that holds a file written from the root", () => {
    const { r, w } = gitRepo();
    fs.mkdirSync(path.join(w, "src"), { recursive: true });
    fs.writeFileSync(path.join(w, "src/a.ts"), "x\n");
    const lesson = path.join(w, ".rulesync/lessons/plan-forks.md");
    const rendered = persistLesson({ workspaceRoot: w, filePath: lesson, content: VALID_LESSON });
    expect(rendered.ok, rendered.error).toBe(true);
    fs.writeFileSync(lesson, rendered.content!);
    const env = { CLAUDE_PROJECT_DIR: r };
    const first = writePlan(path.join(w, "src/a.ts"), r, env, "n1", "y\n");
    expect(first.status, first.stderr).toBe(0);
    const ctx = JSON.parse(first.stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("Recorded lessons match src/a.ts:");
    expect(ctx).toContain(".rulesync/lessons/plan-forks.md (hits 1)");
    // Shown once per session; another session sees it again.
    expect(writePlan(path.join(w, "src/a.ts"), r, env, "n1", "y\n").stdout).toBe("");
    expect(writePlan(path.join(w, "src/a.ts"), r, env, "n2", "y\n").stdout).toContain("Recorded lessons match");
    // The lesson file itself gets no notice about itself.
    expect(writePlan(lesson, r, env, "n3", VALID_LESSON).stdout).not.toContain("Recorded lessons match");
  });

  it("denies a lesson Write in the main checkout and writes nothing there", () => {
    const { r } = gitRepo();
    fs.mkdirSync(path.join(r, "src"), { recursive: true });
    fs.writeFileSync(path.join(r, "src/a.ts"), "x\n");
    const lesson = path.join(r, ".rulesync/lessons/plan-forks.md");
    const alias = aliasOf(r);
    for (const [file, cwd] of [[lesson, r], [path.join(alias, ".rulesync/lessons/plan-forks.md"), alias]] as const) {
      const out = writePlan(file, cwd, { CLAUDE_PROJECT_DIR: cwd }, "m1", VALID_LESSON);
      expect(out.status, out.stderr).toBe(0);
      const res = JSON.parse(out.stdout).hookSpecificOutput;
      expect(res.permissionDecision).toBe("deny");
      expect(res.permissionDecisionReason).toBe(
        `the main checkout is shared: run node ${path.join(r, ".rulesync/scripts/worktree.mjs")} add <name> and write under ${path.join(r, ".worktrees/<name>")}; only ${path.join(r, ".tmp")}${path.sep} is writable here`,
      );
    }
    expect(fs.existsSync(path.join(r, ".rulesync"))).toBe(false);
  });

  it("validates, saves and reindexes a lesson Write to a worktree sent from the root", () => {
    const { r, w } = gitRepo();
    fs.mkdirSync(path.join(w, "src"), { recursive: true });
    fs.writeFileSync(path.join(w, "src/a.ts"), "x\n");
    const lesson = path.join(w, ".rulesync/lessons/plan-forks.md");
    const env = { CLAUDE_PROJECT_DIR: r };
    const bad = JSON.parse(writePlan(lesson, r, env, "w1", VALID_LESSON.replace('["src/**"]', '["lib/**"]')).stdout).hookSpecificOutput;
    expect(bad.permissionDecision).toBe("deny");
    expect(bad.permissionDecisionReason).toMatch(/lib\/\*\* matches no file/);
    const out = writePlan(lesson, r, env, "w1", VALID_LESSON);
    expect(out.status, out.stderr).toBe(0);
    const res = JSON.parse(out.stdout).hookSpecificOutput;
    expect(res.updatedInput.file_path).toBe(lesson);
    expect(res.updatedInput.content).toMatch(/^hits: 1$/m);
    expect(fs.readFileSync(path.join(w, ".rulesync/lessons/INDEX.md"), "utf8")).toContain("plan-forks.md");
    expect(fs.existsSync(path.join(r, ".rulesync"))).toBe(false);
  });

  it("validates a lesson Write in an unmanaged linked worktree outside the root", () => {
    const { r } = gitRepo();
    const outside = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "orch-linked-"))), "linked");
    tmpDirs.push(path.dirname(outside));
    spawnSync("git", ["worktree", "add", "-q", outside, "-b", "linked"], { cwd: r });
    fs.mkdirSync(path.join(outside, "src"), { recursive: true });
    fs.writeFileSync(path.join(outside, "src/a.ts"), "x\n");
    const lesson = path.join(outside, ".rulesync/lessons/plan-forks.md");
    const out = writePlan(lesson, outside, { CLAUDE_PROJECT_DIR: outside }, "u1", VALID_LESSON);
    expect(out.status, out.stderr).toBe(0);
    expect(JSON.parse(out.stdout).hookSpecificOutput.updatedInput.file_path).toBe(lesson);
    expect(fs.readFileSync(path.join(outside, ".rulesync/lessons/INDEX.md"), "utf8")).toContain("plan-forks.md");
    expect(fs.existsSync(path.join(r, ".rulesync"))).toBe(false);
  });

  it("hands a worktree lesson Write back in the worktree and indexes it there", () => {
    const { r, w } = gitRepo();
    fs.mkdirSync(path.join(w, "src"), { recursive: true });
    fs.writeFileSync(path.join(w, "src/a.ts"), "x\n");
    const lesson = path.join(w, ".rulesync/lessons/plan-forks.md");
    const out = writePlan(lesson, w, { CLAUDE_PROJECT_DIR: r }, "s4", VALID_LESSON);
    expect(out.status, out.stderr).toBe(0);
    expect(JSON.parse(out.stdout).hookSpecificOutput.updatedInput.file_path).toBe(lesson);
    expect(fs.readFileSync(path.join(w, ".rulesync/lessons/INDEX.md"), "utf8")).toContain("plan-forks.md");
    expect(fs.existsSync(path.join(r, ".rulesync/lessons/INDEX.md"))).toBe(false);
  });
});

describe("git the user asked for", () => {
  const sessionFile = (ws: string, sid: string) => path.join(ws, ".tmp/repo/sessions", sid, "git-asked.json");
  const words = (ws: string, sid: string) => JSON.parse(fs.readFileSync(sessionFile(ws, sid), "utf8")).words as string[];
  const submit = (ws: string, sid: string, text: string, event = "UserPromptSubmit") => {
    const out = runHook({ cwd: ws, hook_event_name: event, session_id: sid, prompt: text }, { CLAUDE_PROJECT_DIR: ws, GROK_WORKSPACE_ROOT: "" });
    expect(out.status, out.stderr).toBe(0);
    return out;
  };

  it("records the words a Claude, Codex or Grok prompt names, and the next prompt clears them", () => {
    const ws = fs.realpathSync(workspace());
    submit(ws, "g1", "stash the main checkout");
    expect(JSON.parse(fs.readFileSync(sessionFile(ws, "g1"), "utf8"))).toEqual({ words: ["stash"] });
    submit(ws, "g1", "thanks, now carry on");
    expect(words(ws, "g1")).toEqual([]);
    expect(fs.readdirSync(path.dirname(sessionFile(ws, "g1"))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    // Grok spells the payload in camelCase and names the session in its env.
    const grok = runHook(
      { hookEventName: "UserPromptSubmit", userPrompt: "git checkout main", workspaceRoot: ws },
      { GROK_HOOK_EVENT: "UserPromptSubmit", GROK_WORKSPACE_ROOT: ws, GROK_SESSION_ID: "gk" },
    );
    expect(grok.status, grok.stderr).toBe(0);
    expect(words(ws, "gk")).toEqual(["checkout"]);
  });

  it("reads each phrase as one grant or none", () => {
    const ws = fs.realpathSync(workspace());
    const cases: [string, string[]][] = [
      ["stash the main checkout", ["stash"]],
      ["git checkout main", ["checkout"]],
      ["clean up the code", []],
      ["merge to main", []],
      ["the stashed work is in the main checkout", []],
      ["rebase it and force push", ["rebase", "force"]],
    ];
    for (const [text, expected] of cases) {
      submit(ws, "g2", text);
      expect(words(ws, "g2"), text).toEqual(expected);
    }
  });

  it("writes nothing without a session id, and still stamps the prompt gate as before", () => {
    const ws = fs.realpathSync(workspace());
    const out = runHook({ cwd: ws, hook_event_name: "UserPromptSubmit", prompt: "stash it" }, { CLAUDE_PROJECT_DIR: ws, GROK_WORKSPACE_ROOT: "", GROK_SESSION_ID: "" });
    expect(out.status, out.stderr).toBe(0);
    expect(fs.existsSync(path.join(ws, ".tmp/repo/sessions"))).toBe(false);
  });

  it("writes where the gate reads, however odd the session id", () => {
    const ws = fs.realpathSync(workspace());
    // The gate reads git-asked.json beside strategy.json, under the sid with every non-word character removed.
    const readerFile = (sid: string) => path.join(path.dirname(stampPath(ws, sid)), "git-asked.json");
    submit(ws, "../escape", "stash it");
    expect(readerFile("../escape")).toBe(path.join(ws, ".tmp/repo/sessions/escape/git-asked.json"));
    expect(JSON.parse(fs.readFileSync(readerFile("../escape"), "utf8"))).toEqual({ words: ["stash"] });
    expect(fs.existsSync(path.join(ws, ".tmp/escape"))).toBe(false);
    submit(ws, "../", "stash it");
    expect(fs.existsSync(path.join(ws, ".tmp/repo/sessions/git-asked.json"))).toBe(false);
  });

  it("leaves a host stop banner alone and fails open when the session dir cannot be made", () => {
    const ws = fs.realpathSync(workspace());
    submit(ws, "g3", "stash it");
    submit(ws, "g3", "Stop hook feedback: keep going");
    expect(words(ws, "g3")).toEqual(["stash"]);
    const blocked = fs.realpathSync(workspace());
    fs.mkdirSync(path.join(blocked, ".tmp/repo"), { recursive: true });
    fs.writeFileSync(path.join(blocked, ".tmp/repo/sessions"), "a file where the dir should be");
    // The prompt still gets its usual reply; only the stamp is lost.
    expect(submit(blocked, "g4", "stash it").stdout).toContain("additionalContext");
    expect(fs.statSync(path.join(blocked, ".tmp/repo/sessions")).isFile()).toBe(true);
  });
});

describe("harness answers from orchestrate-parent", () => {
  const gateScript = path.join(here, "gate-fat-tools.mjs");
  function repo() {
    const r = fs.realpathSync(workspace());
    spawnSync("git", ["init", "-q"], { cwd: r });
    const a = path.join(r, "packages/a");
    fs.mkdirSync(a, { recursive: true });
    fs.writeFileSync(path.join(a, "big.log"), "x\n".repeat(10));
    return { r, a };
  }
  const run = (script: string, payload: object) =>
    spawnSync(process.execPath, [script], { encoding: "utf8", input: JSON.stringify(payload), cwd: root, env: process.env, timeout: 10_000 });

  it("answers a Codex Bash rewrite with allow", () => {
    const { a } = repo();
    const out = runHook({ session_id: "cx", turn_id: "t1", model: "m", hook_event_name: "PreToolUse", cwd: a, tool_name: "Bash", tool_input: { command: "cat big.log" } });
    expect(out.status, out.stderr).toBe(0);
    const json = JSON.parse(out.stdout);
    expect(json.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(json.hookSpecificOutput.updatedInput.command).toMatch(/job\.mjs --job exec --query /);
  });

  it("denies a Grok git worktree add outside .worktrees", () => {
    const { r } = repo();
    const out = runHook(
      { hookEventName: "PreToolUse", toolName: "run_terminal_command", toolInput: { command: "git worktree add ../elsewhere" }, cwd: r },
      { GROK_HOOK_EVENT: "PreToolUse" },
    );
    expect(out.status, out.stderr).toBe(0);
    expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecisionReason).toMatch(/^worktrees live in /);
  });

  // Antigravity's stdin names no hook event, so orchestrate-parent stays silent and the gate answers alone.
  it("leaves Antigravity calls to the gate", () => {
    const { r, a } = repo();
    for (const toolCall of [
      { name: "run_command", args: { CommandLine: "cat big.log", Cwd: a } },
      { name: "replace_file_content", args: { TargetFile: path.join(a, ".tmp/repo/scratch/x.md"), TargetContent: "a", ReplacementContent: "b" } },
    ]) {
      const payload = { conversationId: "ag", workspacePaths: [r], toolCall };
      const gate = run(gateScript, payload);
      const orch = runHook(payload);
      expect(gate.stdout, toolCall.name).not.toBe("");
      expect(orch.stdout, toolCall.name).toBe("");
    }
    expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
  });
});

// Cursor sends cursor_version and its own camelCase event names. Whatever the hook prints must be empty or a
// reply Cursor accepts: its native deny, Claude's nested form with no top-level field, or decision:block on stop.
describe("Cursor events", () => {
  function repo() {
    const r = fs.realpathSync(workspace());
    spawnSync("git", ["init", "-q"], { cwd: r });
    fs.writeFileSync(path.join(r, "big.log"), "x\n".repeat(10));
    return r;
  }
  const cursor = (cwd: string, hook_event_name: string, extra: object = {}) =>
    runHook(
      { cursor_version: "2026.11.05", session_id: "cu", model: "m", cwd, hook_event_name, ...extra },
      { CLAUDE_PROJECT_DIR: "", GROK_WORKSPACE_ROOT: "" },
    );
  const json = (out: { status: number | null; stdout: string; stderr: string }) => {
    expect(out.status, out.stderr).toBe(0);
    return out.stdout ? JSON.parse(out.stdout) : null;
  };
  const nested = (reply: any) => {
    expect(Object.keys(reply)).toEqual(["hookSpecificOutput"]);
    expect(reply.hookSpecificOutput.permissionDecision).toBeUndefined();
  };

  it("beforeSubmitPrompt prints nothing Cursor would reject and only records what git the user asked for", () => {
    const r = repo();
    // Cursor's event does one thing: git-asked.json. No /ask stamp, board line, approval or additionalContext.
    expect(json(cursor(r, "beforeSubmitPrompt", { prompt: "/ask", attachments: [] }))).toBeNull();
    expect(fs.existsSync(path.join(r, ".tmp/repo/orchestrator-logs"))).toBe(false);
    expect(fs.readdirSync(path.join(r, ".tmp/repo/sessions/cu"))).toEqual(["git-asked.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(r, ".tmp/repo/sessions/cu/git-asked.json"), "utf8"))).toEqual({ words: [] });
    expect(json(cursor(r, "beforeSubmitPrompt", { prompt: "please stash the main checkout", attachments: [] }))).toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(r, ".tmp/repo/sessions/cu/git-asked.json"), "utf8"))).toEqual({ words: ["stash"] });
    expect(fs.existsSync(path.join(r, ".tmp/repo/orchestrator-logs"))).toBe(false);
  });

  it("stop prints nothing for a completed turn and decision:block only for the ask gate", () => {
    const r = repo();
    const done = { status: "completed", loop_count: 0, transcript_path: null };
    expect(json(cursor(r, "stop", done))).toBeNull();
    const stamp = path.join(r, ".tmp/repo/orchestrator-logs", `${SESSION_GATE_STAMP}-cu`);
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, "ask");
    expect(json(cursor(r, "stop", done))).toEqual({ decision: "block", reason: ASK_STOP_REASON });
    expect(json(cursor(r, "stop", { ...done, last_assistant_message: "done. Continue?" }))).toBeNull();
  });

  it("preToolUse Shell dump and Write redirect answer in the nested form", () => {
    const r = repo();
    const shell = json(cursor(r, "preToolUse", { tool_name: "Shell", tool_input: { command: "cat big.log", cwd: r } }));
    nested(shell);
    expect(shell.hookSpecificOutput.updatedInput.command).toMatch(/job\.mjs --job exec --query /);
    const write = json(cursor(r, "preToolUse", { tool_name: "Write", tool_input: { file_path: ".tmp/repo/note.md", content: VALID_TMP } }));
    nested(write);
    const saved = write.hookSpecificOutput.updatedInput.file_path;
    expect(path.dirname(saved)).toBe(path.join(r, ".tmp/repo"));
    expect(fs.existsSync(saved)).toBe(true);
  });

  it("preToolUse denies in Cursor's native shape and passes plain calls through", () => {
    const r = repo();
    const bad = json(cursor(r, "preToolUse", { tool_name: "Write", tool_input: { file_path: ".tmp/repo/plans/x.md", content: "not a plan" } }));
    expect(bad).toMatchObject({ permission: "deny", user_message: expect.any(String), agent_message: expect.any(String) });
    expect(bad.hookSpecificOutput).toBeUndefined();
    const lock = json(cursor(r, "preToolUse", { tool_name: "Shell", tool_input: { command: "cat bun.lock" } }));
    expect(lock).toEqual({ permission: "deny", user_message: expect.any(String), agent_message: expect.any(String) });
    expect(json(cursor(r, "preToolUse", { tool_name: "Read", tool_input: { file_path: "big.log" } }))).toBeNull();
    expect(json(cursor(r, "preToolUse", { tool_name: "Shell", tool_input: { command: "git status" } }))).toBeNull();
  });
});
