import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { orchestrateKit, replyOf, type HookOut } from "./__fixtures__/orchestrate-kit.ts";
import { VALID_HANDOFF, VALID_IMPL, VALID_LESSON, VALID_PLAN, DRAFT_ROADMAP } from "./__fixtures__/persist-bodies.ts";
import { runHook } from "./__fixtures__/run-hook.ts";
import { main } from "./orchestrate-parent.ts";

const kit = orchestrateKit();

/** A PreToolUse caller as Grok sends it; `session` is left out when empty. */
function inSession(session?: string) {
  return (ws: string, toolName: string | undefined, toolInput: unknown): HookOut["hookSpecificOutput"] | null => {
    const payload = { hookEventName: "PreToolUse", session_id: session, toolInput, toolName, workspaceRoot: ws };
    const out = replyOf(runHook(main, payload, { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: ws }));

    return out === null ? null : out.hookSpecificOutput;
  };
}

const pre = inSession();

function saveAs(ws: string, file: string, content: string) {
  return pre(ws, "Write", { content, file_path: file })?.updatedInput.file_path ?? "";
}

describe("a PreToolUse payload that names no usable target", () => {
  it("passes a payload with no tool name", () => {
    expect(pre(kit.temp("tools-"), undefined, { content: "x", file_path: "a.ts" })).toBeNull();
  });

  it("denies a Write that carries no input", () => {
    expect(pre(kit.temp("tools-"), "Write", undefined)?.permissionDecision).toBe("deny");
  });

  it("passes a Write that names no path", () => {
    expect(pre(kit.temp("tools-"), "Write", { content: "x" })).toBeNull();
  });

  it("answers an empty stdin with no reply and exit 0", () => {
    const run = runHook(main, "");
    expect(run).toStrictEqual({ status: 0, stdout: "" });
  });
});

describe("a spawn", () => {
  it("is denied when its prompt is over the cap", () => {
    const out = pre(kit.temp("tools-"), "Task", { prompt: "a".repeat(100_001) });
    expect(out?.permissionDecision).toBe("deny");
  });

  it("passes when it has no input", () => {
    expect(pre(kit.temp("tools-"), "Task", undefined)).toBeNull();
  });

  it("leaves a review record only for a review prompt whose item is saved", () => {
    const ws = kit.temp("tools-");
    saveAs(ws, ".tmp/repo/plans/x.md", VALID_PLAN);
    saveAs(ws, ".tmp/repo/roadmaps/x.md", DRAFT_ROADMAP);
    const record = path.join(ws, ".tmp/repo/sessions/sp/reviews-open.json");
    inSession("sp")(ws, "Task", { prompt: 5 });
    inSession("sp")(ws, "Task", { prompt: "/review-plan 9" });
    expect(fs.existsSync(record)).toBe(false);
    inSession("sp")(ws, "Task", { prompt: "/review-roadmap 1" });
    inSession("sp")(ws, "Task", { prompt: "/review-plan 1" });
    expect(JSON.parse(fs.readFileSync(record, "utf8"))).toStrictEqual({ "plan 1": 0, "roadmap 1": 0 });
  });
});

describe("a write under .tmp/repo", () => {
  it("saves a handoff under handoffs", () => {
    const saved = saveAs(kit.temp("tools-"), ".tmp/repo/handoffs/x.md", VALID_HANDOFF);
    expect(path.basename(path.dirname(saved))).toBe("handoffs");
    expect(path.basename(saved)).toMatch(/^1-sync-skills-to-hosts-/);
  });

  it("denies an Edit of a file that does not exist yet", () => {
    const ws = kit.temp("tools-");

    for (const dir of ["plans", "implementations"]) {
      const out = pre(ws, "Edit", { file_path: `.tmp/repo/${dir}/x.md`, new_string: "b", old_string: "a" });
      expect(out?.permissionDecision, dir).toBe("deny");
    }
  });

  it("passes an Edit of a saved plan whose old text is not in the file", () => {
    const ws = kit.temp("tools-");
    const plan = saveAs(ws, ".tmp/repo/plans/x.md", VALID_PLAN);
    const roadmap = saveAs(ws, ".tmp/repo/roadmaps/x.md", DRAFT_ROADMAP);

    for (const filePath of [plan, roadmap]) {
      const out = pre(ws, "Edit", { file_path: filePath, new_string: "b", old_string: "no such text" });
      expect(out, filePath).toBeNull();
    }
  });
});

function journal(ws: string): string {
  return saveAs(ws, ".tmp/repo/implementations/x.md", VALID_IMPL);
}

describe("a write to a saved journal", () => {
  it("passes an Edit and a Write that is not a full body", () => {
    const ws = kit.temp("tools-");
    const filePath = journal(ws);
    expect(pre(ws, "Edit", { file_path: filePath, new_string: "a", old_string: "(none)" })).toBeNull();
    expect(pre(ws, "Write", { content: "a line", file_path: filePath })).toBeNull();
  });

  it("denies a full body that breaks the journal shape", () => {
    const ws = kit.temp("tools-");
    const out = pre(ws, "Write", { content: "# Title\n\nno sections here\n", file_path: journal(ws) });
    expect(out?.permissionDecision).toBe("deny");
  });
});

/** A workspace holding src/a.ts and a saved lesson that matches it. */
function lessons(): string {
  const ws = kit.temp("tools-");
  fs.mkdirSync(path.join(ws, "src"), { recursive: true });
  fs.writeFileSync(path.join(ws, "src/a.ts"), "x\n");
  saveAs(ws, ".repo/lessons/plan-forks.md", VALID_LESSON);

  return ws;
}

function edit(ws: string, session?: string): HookOut["hookSpecificOutput"] | null {
  return inSession(session)(ws, "Edit", { file_path: "src/a.ts", new_string: "y", old_string: "x" });
}

describe("a lesson notice", () => {
  it("shows again on every edit of a session with no id", () => {
    const ws = lessons();
    expect(edit(ws)?.additionalContext).toContain("plan-forks");
    expect(edit(ws)?.additionalContext).toContain("plan-forks");
  });

  it("starts over when the seen list is not a list", () => {
    const ws = lessons();
    const seen = path.join(ws, ".tmp/repo/sessions/sj/lessons-seen.json");
    fs.mkdirSync(path.dirname(seen), { recursive: true });
    fs.writeFileSync(seen, '{"a":1}');
    expect(edit(ws, "sj")?.additionalContext).toContain("plan-forks");
    expect(JSON.parse(fs.readFileSync(seen, "utf8"))).toStrictEqual([".repo/lessons/plan-forks.md"]);
  });

  it("never blocks the edit when the seen list cannot be saved", () => {
    const ws = lessons();
    fs.mkdirSync(path.join(ws, ".tmp/repo/sessions/sd/lessons-seen.json"), { recursive: true });
    expect(edit(ws, "sd")).toBeNull();
  });
});
