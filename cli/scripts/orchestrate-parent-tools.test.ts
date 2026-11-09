import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VALID_HANDOFF, VALID_IMPL, VALID_LESSON, VALID_PLAN, DRAFT_ROADMAP } from "./fixtures/persist-bodies.ts";
import { runHook } from "./fixtures/run-hook.ts";
import { main } from "./orchestrate-parent.ts";

/** The reply fields a PreToolUse answer carries. */
interface Reply {
  permissionDecision?: string;
  permissionDecisionReason?: string;
  additionalContext?: string;
  updatedInput?: { file_path: string; path: string };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A PreToolUse caller as Grok sends it; `session` is left out when empty. */
const inSession = (session?: string) => (ws: string, toolName: string | undefined, toolInput: unknown) => {
  const payload = { hookEventName: "PreToolUse", toolName, toolInput, workspaceRoot: ws, session_id: session };
  const run = runHook(main, payload, { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: ws });
  expect(run.status).toBe(0);
  if (!run.stdout) return null;
  const out = JSON.parse(run.stdout) /* the hook prints the one shape Reply names */ as { hookSpecificOutput: Reply };
  return out.hookSpecificOutput;
};
const pre = inSession();

const saveAs = (ws: string, file: string, content: string) =>
  pre(ws, "Write", { file_path: file, content })?.updatedInput?.file_path ?? "";

describe("a PreToolUse payload that names no usable target", () => {
  it("passes a payload with no tool name", () => {
    expect(pre(temp("tools-"), undefined, { file_path: "a.ts", content: "x" })).toBeNull();
  });

  it("denies a Write that carries no input", () => {
    expect(pre(temp("tools-"), "Write", undefined)?.permissionDecision).toBe("deny");
  });

  it("passes a Write that names no path", () => {
    expect(pre(temp("tools-"), "Write", { content: "x" })).toBeNull();
  });

  it("answers an empty stdin with no reply and exit 0", () => {
    const run = runHook(main, "");
    expect(run).toEqual({ status: 0, stdout: "" });
  });
});

describe("a spawn", () => {
  it("is denied when its prompt is over the cap", () => {
    const out = pre(temp("tools-"), "Task", { prompt: "a".repeat(100_001) });
    expect(out?.permissionDecision).toBe("deny");
  });

  it("passes when it has no input", () => {
    expect(pre(temp("tools-"), "Task", undefined)).toBeNull();
  });

  it("leaves a review record only for a review prompt whose item is saved", () => {
    const ws = temp("tools-");
    saveAs(ws, ".tmp/repo/plans/x.md", VALID_PLAN);
    saveAs(ws, ".tmp/repo/roadmaps/x.md", DRAFT_ROADMAP);
    const record = path.join(ws, ".tmp/repo/sessions/sp/reviews-open.json");
    inSession("sp")(ws, "Task", { prompt: 5 });
    inSession("sp")(ws, "Task", { prompt: "/review-plan 9" });
    expect(fs.existsSync(record)).toBe(false);
    inSession("sp")(ws, "Task", { prompt: "/review-roadmap 1" });
    inSession("sp")(ws, "Task", { prompt: "/review-plan 1" });
    expect(JSON.parse(fs.readFileSync(record, "utf8"))).toEqual({ "roadmap 1": 0, "plan 1": 0 });
  });
});

describe("a write under .tmp/repo", () => {
  it("saves a handoff under handoffs", () => {
    const saved = saveAs(temp("tools-"), ".tmp/repo/handoffs/x.md", VALID_HANDOFF);
    expect(path.basename(path.dirname(saved))).toBe("handoffs");
    expect(path.basename(saved)).toMatch(/^1-sync-skills-to-hosts-/);
  });

  it("denies an Edit of a file that does not exist yet", () => {
    const ws = temp("tools-");
    for (const dir of ["plans", "implementations"]) {
      const out = pre(ws, "Edit", { file_path: `.tmp/repo/${dir}/x.md`, old_string: "a", new_string: "b" });
      expect(out?.permissionDecision, dir).toBe("deny");
    }
  });

  it("passes an Edit of a saved plan whose old text is not in the file", () => {
    const ws = temp("tools-");
    const plan = saveAs(ws, ".tmp/repo/plans/x.md", VALID_PLAN);
    const roadmap = saveAs(ws, ".tmp/repo/roadmaps/x.md", DRAFT_ROADMAP);
    for (const file_path of [plan, roadmap]) {
      expect(pre(ws, "Edit", { file_path, old_string: "no such text", new_string: "b" }), file_path).toBeNull();
    }
  });
});

describe("a write to a saved journal", () => {
  function journal(ws: string) {
    return saveAs(ws, ".tmp/repo/implementations/x.md", VALID_IMPL);
  }

  it("passes an Edit and a Write that is not a full body", () => {
    const ws = temp("tools-");
    const file_path = journal(ws);
    expect(pre(ws, "Edit", { file_path, old_string: "(none)", new_string: "a" })).toBeNull();
    expect(pre(ws, "Write", { file_path, content: "a line" })).toBeNull();
  });

  it("denies a full body that breaks the journal shape", () => {
    const ws = temp("tools-");
    const out = pre(ws, "Write", { file_path: journal(ws), content: "# Title\n\nno sections here\n" });
    expect(out?.permissionDecision).toBe("deny");
  });
});

describe("a lesson notice", () => {
  function lessons() {
    const ws = temp("tools-");
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "src/a.ts"), "x\n");
    saveAs(ws, ".repo/lessons/plan-forks.md", VALID_LESSON);
    return ws;
  }
  const edit = (ws: string, session?: string) =>
    inSession(session)(ws, "Edit", { file_path: "src/a.ts", old_string: "x", new_string: "y" });

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
    expect(JSON.parse(fs.readFileSync(seen, "utf8"))).toEqual([".repo/lessons/plan-forks.md"]);
  });

  it("never blocks the edit when the seen list cannot be saved", () => {
    const ws = lessons();
    fs.mkdirSync(path.join(ws, ".tmp/repo/sessions/sd/lessons-seen.json"), { recursive: true });
    expect(edit(ws, "sd")).toBeNull();
  });
});
