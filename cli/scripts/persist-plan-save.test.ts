import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_LESSON, VALID_PLAN } from "./fixtures/persist-bodies.ts";
import { persistLesson } from "./lessons-ops.ts";
import { persistPlan, preparePlanUpdate } from "./persist-plan.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

function tmpWs() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "persist-plan-save-")));
  tmpDirs.push(dir);
  return dir;
}

// A harness that names its workspace through the environment instead of an argument.
function envWorkspace() {
  const ws = tmpWs();
  vi.stubEnv("CLAUDE_PROJECT_DIR", ws);
  vi.stubEnv("GROK_WORKSPACE_ROOT", ws);
  return ws;
}

const created = "2026-08-26T14:30:00Z";

describe("persistPlan names", () => {
  it("cuts a long plan name to a 50-character slug in the saved filename", () => {
    const ws = tmpWs();
    const content = VALID_PLAN.replace("PLAN_NAME: add tmp ignore", `PLAN_NAME: ${"abcdefghi ".repeat(8)}`);
    const r = persistPlan({ content, created, workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    expect(r.filename).toBe("1-abcdefghi-abcdefghi-abcdefghi-abcdefghi-abcdefghi-20260826T143000Z.md");
  });

  it("takes the source from the argument, the plan name, or the Goal", () => {
    const named = persistPlan({ content: VALID_PLAN, created, source: "typed by hand", workspaceRoot: tmpWs() });
    expect(named.content).toContain('source: "typed by hand"');
    const byName = persistPlan({ content: VALID_PLAN, created, workspaceRoot: tmpWs() });
    expect(byName.content).toContain('source: "add tmp ignore"');
    const unnamed = VALID_PLAN.replace(/^PLAN_NAME: .*\n/, "").replace("# add-tmp-ignore\n", "");
    const byGoal = persistPlan({ content: unnamed, created, workspaceRoot: tmpWs() });
    expect(byGoal.ok, byGoal.error).toBe(true);
    expect(byGoal.filename).toBe("1-unnamed-20260826T143000Z.md");
    const goal =
      "Repo .gitignore ignores .tmp/ so files under .tmp/repo/plans/ stay untracked. Existing ignore entries stay.";
    expect(byGoal.content).toContain(`source: ${JSON.stringify(goal)}`);
  });
});

describe("persistPlan denials", () => {
  it("denies a body with no name, title or Goal and writes nothing", () => {
    const ws = tmpWs();
    const r = persistPlan({ content: "just words", workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(fs.readdirSync(path.join(ws, ".tmp/repo/plans"))).toStrictEqual([]);
  });

  it("denies a save whose frontmatter never closes", () => {
    const ws = tmpWs();
    const r = persistPlan({ content: `---\nserial: 1\n${VALID_PLAN}`, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(fs.readdirSync(path.join(ws, ".tmp/repo/plans"))).toStrictEqual([]);
  });

  it("denies an empty save the same way", () => {
    const ws = tmpWs();
    expect(persistPlan({ workspaceRoot: ws }).ok).toBe(false);
    expect(fs.readdirSync(path.join(ws, ".tmp/repo/plans"))).toStrictEqual([]);
  });
});

describe("persistPlan serials", () => {
  it("refuses to overwrite a file when the next serial cannot move past it", () => {
    const ws = tmpWs();
    const dir = path.join(ws, ".tmp/repo/plans");
    fs.mkdirSync(dir, { recursive: true });
    // 2^53: adding one to it gives it back, so the next serial names the planted file.
    const planted = path.join(dir, "9007199254740992-demo-20260826T143000Z.md");
    fs.writeFileSync(planted, "keep me");
    const content = VALID_PLAN.replace("PLAN_NAME: add tmp ignore", "PLAN_NAME: demo");
    const r = persistPlan({ content, created, workspaceRoot: ws });
    expect(r).toStrictEqual({ error: "serial collision", ok: false });
    expect(fs.readFileSync(planted, "utf8")).toBe("keep me");
  });
});

describe("persistPlan without a workspace argument", () => {
  it("saves under the root the environment names", () => {
    const ws = envWorkspace();
    const r = persistPlan({ content: VALID_PLAN, created });
    expect(r.ok, r.error).toBe(true);
    expect(fs.existsSync(path.join(ws, ".tmp/repo/plans", String(r.filename)))).toBe(true);
  });

  it("denies an empty call and still prepares that root's plans dir", () => {
    const ws = envWorkspace();
    expect(persistPlan().ok).toBe(false);
    expect(fs.readdirSync(path.join(ws, ".tmp/repo/plans"))).toStrictEqual([]);
  });

  it("validates an update of a saved plan against that root", () => {
    const ws = envWorkspace();
    const first = persistPlan({ content: VALID_PLAN, created, workspaceRoot: ws });
    const r = preparePlanUpdate({ content: String(first.content), filePath: String(first.path) });
    expect(r.ok, r.error).toBe(true);
    expect(r.path).toBe(first.path);
  });
});

describe("preparePlanUpdate edges", () => {
  function savedPlan(ws: string) {
    const r = persistPlan({ content: VALID_PLAN, created, workspaceRoot: ws });
    return path.join(ws, String(r.path));
  }

  it("denies an update with no content", () => {
    const ws = tmpWs();
    expect(preparePlanUpdate({ filePath: savedPlan(ws), workspaceRoot: ws }).ok).toBe(false);
  });

  it("denies an update with an unclosed fence before anything else", () => {
    const ws = tmpWs();
    const r = preparePlanUpdate({ content: "```\nopen\n", filePath: savedPlan(ws), workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.errors).toStrictEqual(["unclosed code fence at line 1: close it with the same fence"]);
  });

  it("gives a body-only update with no title the saved plan's title", () => {
    const ws = tmpWs();
    const body = VALID_PLAN.replace("# add-tmp-ignore\n", "");
    const r = preparePlanUpdate({ content: body, filePath: savedPlan(ws), workspaceRoot: ws });
    expect(r.ok, r.error).toBe(true);
    expect(r.content).toContain("\n---\n\n# add-tmp-ignore\n\nWHAT ");
  });
});

describe("lesson citations without a Watch-outs section", () => {
  it("denies a plan naming a matched file when it has no Watch-outs to cite in", () => {
    const ws = tmpWs();
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "src/a.ts"), "x\n");
    const file = path.join(ws, ".repo/lessons/plan-forks.md");
    const lesson = persistLesson({ content: VALID_LESSON, filePath: file, workspaceRoot: ws });
    if (!lesson.ok) throw new Error(lesson.error);
    fs.writeFileSync(file, lesson.content);
    const content = VALID_PLAN.replace("1.1 [ ] read the gitignore if it exists", "1.1 [ ] edit src/a.ts").replace(
      /## Watch-outs\n[\s\S]*?\n\n/,
      "",
    );
    const r = persistPlan({ content, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("cite this matched lesson in Watch-outs: .repo/lessons/plan-forks.md");
  });
});
