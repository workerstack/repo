import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  quoteQuery,
  CHILD_GREP_HEAD_LIMIT,
  CHILD_READ_LIMIT,
  DEFAULT_GREP_HEAD_LIMIT,
  DEFAULT_READ_LIMIT,
  DENY_FILE_BYTES,
  GLOB_IGNORE,
  REASON_DENYLIST,
  REASON_FILE_SIZE,
  REASON_IMPLEMENTER_BASH,
  REASON_REREAD,
  bashTargetsDenylist,
  answerDeny,
  answerRewrite,
  hasChildAgentMarker,
  isParentOrchestrator,
  subagentTypeOf,
  pathIsDenied,
  processFatTools,
  processHookPayload,
  rewriteGruntScratchPath,
  rewritePatch,
  rewriteScratchWrite,
} from "./gate-fat-tools.mjs";
import {
  DENY_REASON,
  ORCHESTRATOR_LOGS_DIR,
} from "../../.grok/hooks/orchestrate-parent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const gate = path.join(here, "gate-fat-tools.mjs");
const R = (ws: string) => ({ root: ws, checkout: ws, cwd: ws });
const orchParent = path.join(root, ".grok/hooks/orchestrate-parent.js");

function runHook(
  script: string,
  payload: unknown,
  env: NodeJS.ProcessEnv = {},
) {
  return spawnSync(process.execPath, [script], {
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

function tmpFile(bytes: number, name = "blob.bin") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-fat-"));
  tmpDirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.alloc(bytes));
  return file;
}

describe("pathIsDenied", () => {
  it("denies denylist segments, lockfiles, and .git/", () => {
    expect(pathIsDenied("node_modules/left-pad/index.js")).toBe(true);
    expect(pathIsDenied("apps/web/.next/cache")).toBe(true);
    expect(pathIsDenied("dist/index.js")).toBe(true);
    expect(pathIsDenied("coverage/lcov.info")).toBe(true);
    expect(pathIsDenied("build/out.js")).toBe(true);
    expect(pathIsDenied("package-lock.json")).toBe(true);
    expect(pathIsDenied("pnpm-lock.yaml")).toBe(true);
    expect(pathIsDenied(".git/objects/pack")).toBe(true);
    expect(pathIsDenied("src/index.ts")).toBe(false);
    expect(pathIsDenied(".gitignore")).toBe(false);
    expect(pathIsDenied(".github/workflows/ci.yml")).toBe(false);
  });
});

describe("bashTargetsDenylist", () => {
  it("catches cat/rg/find on denylist paths, not cargo build", () => {
    expect(bashTargetsDenylist("cat package-lock.json")).toBe(true);
    expect(bashTargetsDenylist("rg foo node_modules")).toBe(true);
    expect(bashTargetsDenylist("find dist -name '*.js'")).toBe(true);
    expect(bashTargetsDenylist("cat .git/objects/pack/foo")).toBe(true);
    expect(bashTargetsDenylist("cargo build")).toBe(false);
    expect(bashTargetsDenylist("cat src/index.ts")).toBe(false);
  });
});

describe("isParentOrchestrator", () => {
  it("is true when subagent type is absent, false when set", () => {
    expect(isParentOrchestrator({})).toBe(true);
    expect(isParentOrchestrator({ toolName: "grep" })).toBe(true);
    expect(isParentOrchestrator({ subagentType: "implementer" })).toBe(false);
    expect(isParentOrchestrator({ subagent_type: "thinker" })).toBe(false);
    expect(isParentOrchestrator({ agentType: "grunt" })).toBe(false);
    expect(isParentOrchestrator({ agent_type: "implementer" })).toBe(false);
    expect(isParentOrchestrator({ agentId: "implementer" })).toBe(false);
    expect(isParentOrchestrator({ agent_id: "thinker" })).toBe(false);
    expect(isParentOrchestrator({ spawnedBy: "grunt" })).toBe(false);
    expect(isParentOrchestrator({ spawned_by: "implementer" })).toBe(false);
    expect(
      isParentOrchestrator({
        agentId: "b2c6f0d4-0000-4000-8000-000000000000",
      }),
    ).toBe(false);
    expect(hasChildAgentMarker({ agentId: "b2c6f0d4-0000-4000-8000-000000000000" })).toBe(
      true,
    );
    expect(hasChildAgentMarker({})).toBe(false);
    expect(isParentOrchestrator({ agent: { type: "implementer" } })).toBe(false);
    expect(subagentTypeOf({ agent_id: "implementer" })).toBe("implementer");
    expect(subagentTypeOf({ agentId: "b2c6f0d4-0000-4000-8000-000000000000" })).toBe("");
  });
});

describe("processFatTools parent inject/deny", () => {
  it("injects Grep head_limit when missing", () => {
    expect(
      processFatTools({
        toolName: "grep",
        toolInput: { pattern: "foo", path: "src" },
      }),
    ).toEqual({
      type: "rewrite",
      updatedInput: {
        pattern: "foo",
        path: "src",
        head_limit: DEFAULT_GREP_HEAD_LIMIT,
      },
    });
  });

  it("injects Read limit when missing", () => {
    const file = tmpFile(100, "small.txt");
    expect(
      processFatTools({
        toolName: "read_file",
        workspaceRoot: path.dirname(file),
        toolInput: { target_file: file },
      }),
    ).toEqual({
      type: "rewrite",
      updatedInput: { target_file: file, limit: DEFAULT_READ_LIMIT },
    });
  });

  it("keeps an existing small head_limit", () => {
    expect(
      processFatTools({
        toolName: "Grep",
        toolInput: { pattern: "x", head_limit: 10 },
      }),
    ).toBeNull();
  });

  it("rewrites head_limit over MAX to the default", () => {
    expect(
      processFatTools({
        toolName: "grep",
        toolInput: { pattern: "x", head_limit: 501 },
      }),
    ).toEqual({
      type: "rewrite",
      updatedInput: { pattern: "x", head_limit: DEFAULT_GREP_HEAD_LIMIT },
    });
  });

  it("denies files larger than 200KB even with limit", () => {
    const file = tmpFile(DENY_FILE_BYTES + 1, "huge.bin");
    expect(
      processFatTools({
        toolName: "Read",
        toolInput: { file_path: file, limit: 20 },
      }),
    ).toEqual({ type: "deny", reason: REASON_FILE_SIZE });
  });

  it("denies denylist Read/Grep/Glob paths", () => {
    expect(
      processFatTools({
        toolName: "read_file",
        toolInput: { target_file: "node_modules/x/index.js" },
      }),
    ).toEqual({ type: "deny", reason: REASON_DENYLIST });
    expect(
      processFatTools({
        toolName: "grep",
        toolInput: { pattern: "x", path: "dist" },
      }),
    ).toEqual({ type: "deny", reason: REASON_DENYLIST });
    expect(
      processFatTools({
        toolName: "list_dir",
        toolInput: { target_directory: ".git/objects" },
      }),
    ).toEqual({ type: "deny", reason: REASON_DENYLIST });
    expect(
      processFatTools({
        toolName: "Read",
        toolInput: { file_path: "yarn.lock" },
      }),
    ).toEqual({ type: "deny", reason: REASON_DENYLIST });
  });

  it("injects 150/400 for implementer; grunt is unscoped", () => {
    expect(
      processFatTools({
        subagentType: "implementer",
        toolName: "grep",
        toolInput: { pattern: "foo" },
      }),
    ).toEqual({
      type: "rewrite",
      updatedInput: { pattern: "foo", head_limit: CHILD_GREP_HEAD_LIMIT },
    });
    const file = tmpFile(100, "child-small.txt");
    expect(
      processFatTools({
        subagentType: "implementer",
        toolName: "read_file",
        toolInput: { target_file: file },
      }),
    ).toEqual({
      type: "rewrite",
      updatedInput: { target_file: file, limit: CHILD_READ_LIMIT },
    });
    expect(
      processFatTools({
        subagentType: "grunt",
        toolName: "read_file",
        toolInput: { target_file: "node_modules/x.js" },
      }),
    ).toBeNull();
  });

  it("unknown child Grep/Glob get child limits; not denied", () => {
    expect(
      processFatTools({
        subagentType: "explore",
        toolName: "grep",
        toolInput: { pattern: "foo" },
      }),
    ).toEqual({
      type: "rewrite",
      updatedInput: { pattern: "foo", head_limit: CHILD_GREP_HEAD_LIMIT },
    });
    expect(
      processFatTools({
        subagentType: "explore",
        toolName: "run_terminal_command",
        toolInput: { command: "pwd" },
      }),
    ).toBeNull();
  });

  it("injects 400 for unknown child Read; unknown sergeant Grep still 150", () => {
    const file = tmpFile(80, "thinker-small.txt");
    expect(
      processFatTools({
        subagentType: "thinker",
        toolName: "read_file",
        toolInput: { target_file: file },
      }),
    ).toEqual({
      type: "rewrite",
      updatedInput: { target_file: file, limit: CHILD_READ_LIMIT },
    });
    expect(
      processFatTools({
        subagentType: "sergeant",
        toolName: "grep",
        toolInput: { pattern: "bar" },
      }),
    ).toEqual({
      type: "rewrite",
      updatedInput: { pattern: "bar", head_limit: CHILD_GREP_HEAD_LIMIT },
    });
  });

  it("denies implementer/thinker files larger than 200KB", () => {
    const file = tmpFile(DENY_FILE_BYTES + 1, "child-huge.bin");
    expect(
      processFatTools({
        subagentType: "implementer",
        toolName: "Read",
        toolInput: { file_path: file, limit: 20 },
      }),
    ).toEqual({ type: "deny", reason: REASON_FILE_SIZE });
    expect(
      processFatTools({
        subagentType: "thinker",
        toolName: "read_file",
        toolInput: { target_file: file, limit: 20 },
      }),
    ).toEqual({ type: "deny", reason: REASON_FILE_SIZE });
  });

  it("denies implementer path denylist and fat bash", () => {
    expect(
      processFatTools({
        subagentType: "implementer",
        toolName: "read_file",
        toolInput: { target_file: "package-lock.json" },
      }),
    ).toEqual({ type: "deny", reason: REASON_DENYLIST });
    expect(
      processFatTools({
        subagent_type: "implementer",
        toolName: "run_terminal_command",
        toolInput: { command: "cat node_modules/x" },
      }),
    ).toEqual({ type: "deny", reason: REASON_DENYLIST });
    expect(
      processFatTools({
        subagentType: "implementer",
        toolName: "Bash",
        toolInput: { command: "npm test" },
      }),
    ).toEqual({ type: "deny", reason: REASON_IMPLEMENTER_BASH });
    expect(
      processFatTools({
        subagentType: "implementer",
        toolName: "Bash",
        toolInput: { command: "curl https://example.com" },
      })?.type,
    ).toBe("rewrite");
    expect(
      processFatTools({
        subagentType: "implementer",
        toolName: "Bash",
        toolInput: { command: "rtk npm test --ultra-compact" },
      }),
    ).toBeNull();
  });

  it("allows implementer workspace grunt-job search|exec|test; denies raw npm test", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-fat-gj-"));
    tmpDirs.push(ws);
    fs.mkdirSync(path.join(ws, ".rulesync", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".rulesync/scripts/grunt-job.mjs"), "");
    expect(
      processFatTools({
        subagentType: "implementer",
        workspaceRoot: ws,
        toolName: "Bash",
        toolInput: {
          command: "node .rulesync/scripts/grunt-job.mjs --job test --query npm test",
        },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        subagentType: "implementer",
        workspaceRoot: ws,
        toolName: "Bash",
        toolInput: {
          command: "node .rulesync/scripts/grunt-job.mjs --job search --query foo|bar",
        },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        subagentType: "implementer",
        workspaceRoot: ws,
        toolName: "Bash",
        toolInput: {
          command: "node .rulesync/scripts/grunt-job.mjs --job exec --query true",
        },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        subagentType: "implementer",
        workspaceRoot: ws,
        toolName: "Bash",
        toolInput: { command: "npm test" },
      }),
    ).toEqual({ type: "deny", reason: REASON_IMPLEMENTER_BASH });
  });
});

describe("gate-fat-tools adapter (stdin)", () => {
  it("fail-opens on invalid JSON", () => {
    const result = runHook(gate, "{not json");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("emits deny JSON with permissionDecision", () => {
    const data = {
      hookEventName: "PreToolUse",
      toolName: "grep",
      toolInput: { pattern: "x", path: "node_modules" },
    };
    const result = runHook(gate, data);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(answerDeny(data, REASON_DENYLIST));
  });

  it("emits updatedInput for missing grep limit", () => {
    const data = {
      tool_name: "Grep",
      tool_input: { pattern: "foo" },
    };
    const result = runHook(gate, data);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      answerRewrite(data, { pattern: "foo", head_limit: DEFAULT_GREP_HEAD_LIMIT }),
    );
  });
});

describe("orchestrate-parent fat tools (Grok SSOT)", () => {
  it("allows parent grep and injects head_limit", () => {
    const result = runHook(
      orchParent,
      {
        hookEventName: "PreToolUse",
        toolName: "grep",
        toolInput: { pattern: "foo", path: "src" },
      },
      { GROK_HOOK_EVENT: "pre_tool_use" },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.updatedInput).toEqual({
      pattern: "foo",
      path: "src",
      head_limit: DEFAULT_GREP_HEAD_LIMIT,
    });
  });

  it("parent-escape still fat-gates grep head_limit", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "orch-fat-escape-"));
    fs.mkdirSync(path.join(ws, ORCHESTRATOR_LOGS_DIR), { recursive: true });
    fs.writeFileSync(path.join(ws, ORCHESTRATOR_LOGS_DIR, "parent-escape-ge"), "1");
    const result = runHook(
      orchParent,
      {
        hookEventName: "PreToolUse",
        toolName: "grep",
        toolInput: { pattern: "foo", path: "src" },
        workspaceRoot: ws,
        sessionId: "ge",
      },
      {
        GROK_HOOK_EVENT: "pre_tool_use",
        GROK_WORKSPACE_ROOT: ws,
        GROK_SESSION_ID: "ge",
      },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.updatedInput).toEqual({
      pattern: "foo",
      path: "src",
      head_limit: DEFAULT_GREP_HEAD_LIMIT,
    });
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("denies denylist read", () => {
    const result = runHook(
      orchParent,
      {
        hookEventName: "PreToolUse",
        toolName: "read_file",
        toolInput: { target_file: "dist/bundle.js" },
      },
      { GROK_HOOK_EVENT: "pre_tool_use" },
    );
    expect(JSON.parse(result.stdout).decision).toBe("block");
  });

  it("rewrites parent ls to rtk", () => {
    const result = runHook(
      orchParent,
      {
        hookEventName: "PreToolUse",
        toolName: "run_terminal_command",
        toolInput: { command: "ls" },
      },
      { GROK_HOOK_EVENT: "pre_tool_use" },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.updatedInput.command).toBe(
      "rtk ls",
    );
  });
});

describe("processHookPayload", () => {
  it("returns null when there is nothing to do", () => {
    expect(processHookPayload({ toolName: "todo_write", toolInput: {} })).toBeNull();
  });
});

describe("rewriteGruntScratchPath", () => {
  const ws = "/home/ecomet/Development/grunt-test-2";

  it("rewrites outside-ws */.tmp/grunt/* into workspace scratch", () => {
    expect(
      rewriteGruntScratchPath("/tmp/host/.tmp/grunt/notes.md", R(ws)),
    ).toBe(path.resolve(ws, ".tmp/grunt/notes.md"));
    expect(
      rewriteGruntScratchPath("/var/foo/.tmp/grunt/handoffs/draft.md", R(ws)),
    ).toBe(path.resolve(ws, ".tmp/grunt/handoffs/draft.md"));
  });

  it("rejects empty, .., and escaped rel", () => {
    expect(rewriteGruntScratchPath("", R(ws))).toBeNull();
    expect(rewriteGruntScratchPath("/tmp/x/.tmp/grunt/", R(ws))).toBeNull();
    expect(
      rewriteGruntScratchPath("/tmp/x/.tmp/grunt/../../etc/passwd", R(ws)),
    ).toBeNull();
    expect(
      rewriteGruntScratchPath("/tmp/x/.tmp/grunt/../escape.md", R(ws)),
    ).toBeNull();
    expect(rewriteGruntScratchPath("/tmp/x/.tmp/grunt//abs", R(ws))).not.toBe(
      "/abs",
    );
  });

  it("does not rewrite in-workspace paths or non-scratch", () => {
    expect(
      rewriteGruntScratchPath(path.join(ws, ".tmp/grunt/notes.md"), R(ws)),
    ).toBeNull();
    expect(rewriteGruntScratchPath(path.join(ws, "src/index.ts"), R(ws))).toBeNull();
    expect(rewriteGruntScratchPath("src/index.ts", R(ws))).toBeNull();
  });
});

describe("processFatTools implementer write-allowlist", () => {
  function writePlan(ws: string, status: string, listed: string) {
    const plans = path.join(ws, ".tmp", "grunt", "plans");
    fs.mkdirSync(plans, { recursive: true });
    const planPath = path.join(plans, "1-listed-20260827T173530Z.md");
    fs.writeFileSync(
      planPath,
      `---
serial: 1
name: listed
status: ${status}
created: 2026-08-27T17:35:30Z
source: "test"
---

# listed

Listed src: \`${listed}\`
https://example.com/README.md
`,
    );
    return planPath;
  }

  it("allows listed src and plan path; denies README/docs/examples; allows unlisted src", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-impl-write-"));
    tmpDirs.push(ws);
    const listed = path.join(ws, "src", "listed.ts");
    const planPath = writePlan(ws, "in-progress", listed);
    expect(
      processFatTools({
        subagentType: "grunt",
        workspaceRoot: ws,
        toolName: "Write",
        toolInput: { file_path: listed, content: "ok" },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        subagentType: "grunt",
        workspaceRoot: ws,
        toolName: "Edit",
        toolInput: { file_path: planPath, old_string: "a", new_string: "b" },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        workspaceRoot: ws,
        toolName: "Write",
        toolInput: { file_path: path.join(ws, "README.md"), content: "no" },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        workspaceRoot: ws,
        toolName: "Write",
        toolInput: { file_path: path.join(ws, "src/other.ts"), content: "ok" },
      }),
    ).toBeNull();
  });

  it("prompt-listed path allowed despite in-progress plan; prompt exclusive denies unlisted", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-impl-prompt-"));
    tmpDirs.push(ws);
    writePlan(ws, "in-progress", path.join(ws, "src", "listed.ts"));
    const promptPath = path.join(ws, "scripts", "gate-fat-tools.mjs");
    const prompt = "Fix `" + promptPath + "`";
    expect(
      processFatTools({
        workspaceRoot: ws,
        prompt,
        toolName: "Write",
        toolInput: { file_path: promptPath, content: "ok" },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        workspaceRoot: ws,
        prompt,
        toolName: "Write",
        toolInput: { file_path: path.join(ws, "src/other.ts"), content: "no" },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        workspaceRoot: ws,
        userPrompt: "touch `" + path.join(ws, "README.md") + "`",
        toolName: "Write",
        toolInput: { file_path: path.join(ws, "README.md"), content: "ok" },
      }),
    ).toBeNull();
  });

  it("with no in-progress plan denies README.md and allows unlisted src", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-impl-nop-"));
    tmpDirs.push(ws);
    writePlan(ws, "ready", path.join(ws, "src", "listed.ts"));
    expect(
      processFatTools({
        workspaceRoot: ws,
        toolName: "Write",
        toolInput: { file_path: path.join(ws, "README.md"), content: "no" },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        workspaceRoot: ws,
        toolName: "Write",
        toolInput: { file_path: path.join(ws, "src/other.ts"), content: "ok" },
      }),
    ).toBeNull();
  });
});

describe("processFatTools Write|Edit scratch rewrite", () => {
  const ws = "/home/ecomet/Development/grunt-test-2";

  it("rewrites Write/Edit/write/search_replace path fields and never denies", () => {
    const outside = "/tmp/host/.tmp/grunt/scratch/notes.md";
    const dest = path.resolve(ws, ".tmp/grunt/scratch/notes.md");
    for (const toolName of ["Write", "Edit", "write", "search_replace"] as const) {
      const field = toolName === "search_replace" ? "file_path" : "file_path";
      const out = processFatTools({
        toolName,
        toolInput: { [field]: outside, content: "x" },
        workspaceRoot: ws,
      });
      expect(out).toEqual({
        type: "rewrite",
        updatedInput: { [field]: dest, content: "x" },
      });
    }
  });

  it("leaves a Write that orchestrate-parent persists to that hook", () => {
    for (const rel of ["notes.md", "plans/x.md", "roadmaps/x.md", "handoffs/x.md", "implementations/x.md"]) {
      const out = processFatTools({ toolName: "Write", toolInput: { file_path: `/tmp/host/.tmp/grunt/${rel}`, content: "x" }, workspaceRoot: ws });
      expect(out, rel).toBeNull();
    }
  });

  it("Claude-style parent Write to src does not deny", () => {
    expect(
      processFatTools({
        toolName: "Write",
        toolInput: { file_path: path.join(ws, "src/index.ts"), content: "export {}\n" },
        workspaceRoot: ws,
      }),
    ).toBeNull();
    expect(
      processHookPayload({
        toolName: "Edit",
        toolInput: { file_path: "src/index.ts", old_string: "a", new_string: "b" },
        workspaceRoot: ws,
      }),
    ).toBeNull();
  });

  it("does not rewrite an escaping scratch path and still does not deny", () => {
    expect(
      processFatTools({
        toolName: "Write",
        toolInput: {
          file_path: "/tmp/x/.tmp/grunt/../../etc/passwd",
          content: "nope",
        },
        workspaceRoot: ws,
      }),
    ).toBeNull();
  });
});

describe("list_dir ignore/deny", () => {
  it("denies list_dir node_modules", () => {
    expect(
      processFatTools({
        toolName: "list_dir",
        toolInput: { target_directory: "node_modules" },
      }),
    ).toEqual({ type: "deny", reason: REASON_DENYLIST });
  });

  it("injects ignore when list_dir has no path and is not denied", () => {
    expect(
      processFatTools({
        toolName: "list_dir",
        toolInput: {},
      }),
    ).toEqual({
      type: "rewrite",
      updatedInput: { ignore: GLOB_IGNORE },
    });
  });

  it("denies glob **/node_modules/**", () => {
    expect(
      processFatTools({
        toolName: "glob",
        toolInput: { glob_pattern: "**/node_modules/**" },
      }),
    ).toEqual({ type: "deny", reason: REASON_DENYLIST });
  });

  it("grunt remains unscoped", () => {
    expect(
      processFatTools({
        subagentType: "grunt",
        toolName: "list_dir",
        toolInput: { target_directory: "node_modules" },
      }),
    ).toBeNull();
  });
});

describe("scratch rewrite and reread", () => {
  it("rewrites repo-root notes.md and leaves README", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-scratch-"));
    tmpDirs.push(ws);
    expect(rewriteScratchWrite("notes.md", R(ws))).toBe(
      path.join(ws, ".tmp", "grunt", "notes.md"),
    );
    expect(rewriteScratchWrite("README.md", R(ws))).toBeNull();
    const out = processFatTools({
      workspaceRoot: ws,
      toolName: "Write",
      toolInput: { file_path: "notes.md", content: "x" },
    });
    expect(out?.type).toBe("rewrite");
    expect((out as { updatedInput: { file_path: string } }).updatedInput.file_path).toBe(
      path.join(ws, ".tmp", "grunt", "notes.md"),
    );
    expect(
      processFatTools({
        workspaceRoot: ws,
        toolName: "Write",
        toolInput: { file_path: "README.md", content: "x" },
      }),
    ).toBeNull();
  });

  it("denies full Read of a path this session wrote; allows offset", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-reread-"));
    tmpDirs.push(ws);
    const file = path.join(ws, "src", "a.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "export {}\n");
    processFatTools({
      workspaceRoot: ws,
      sessionId: "sid1",
      toolName: "Write",
      toolInput: { file_path: file, content: "export {}\n" },
    });
    expect(
      processFatTools({
        workspaceRoot: ws,
        sessionId: "sid1",
        toolName: "Read",
        toolInput: { file_path: file },
      }),
    ).toEqual({ type: "deny", reason: REASON_REREAD });
    const sliced = processFatTools({
      workspaceRoot: ws,
      sessionId: "sid1",
      toolName: "Read",
      toolInput: { file_path: file, offset: 1, limit: 20 },
    });
    expect(sliced?.type).not.toBe("deny");
  });

  it("rewrites bash dump to grunt-job and ls to rtk", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-bash-"));
    tmpDirs.push(ws);
    const dump = processFatTools({
      workspaceRoot: ws,
      toolName: "Bash",
      toolInput: { command: "cat src/a.ts" },
    });
    expect(dump?.type).toBe("rewrite");
    expect(
      (dump as { updatedInput: { command: string } }).updatedInput.command,
    ).toMatch(/grunt-job\.mjs --job exec --query /);
    const ls = processFatTools({
      workspaceRoot: ws,
      toolName: "Bash",
      toolInput: { command: "ls src" },
    });
    expect(ls).toEqual({
      type: "rewrite",
      updatedInput: { command: "rtk ls src" },
    });
  });

  it("passes compound bash through untouched", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-bash-"));
    tmpDirs.push(ws);
    for (const command of [
      "cd src && cat a.ts",
      "grep -n x a.ts | head",
      "cat > a.md <<'EOF'\n`su` $HOME\nEOF",
      "ls; ls src",
    ]) {
      expect(
        processFatTools({ workspaceRoot: ws, toolName: "Bash", toolInput: { command } }),
      ).toBeNull();
    }
  });

  it("single-quotes rewritten queries so backticks and $ stay literal", () => {
    expect(quoteQuery("a `su` $HOME it's")).toBe("'a `su` $HOME it'\\''s'");
  });
});


describe("nested scratch redirect", () => {
  const r = path.resolve("/r");
  const roots = { root: r, checkout: r, cwd: path.join(r, "packages/a") };

  it("sends a nested or worktree .tmp/grunt Write to the root's", () => {
    const dest = path.join(r, ".tmp/grunt/scratch/x.txt");
    expect(rewriteGruntScratchPath(path.join(r, "packages/a/.tmp/grunt/scratch/x.txt"), roots)).toBe(dest);
    expect(rewriteGruntScratchPath(path.join(r, ".worktrees/w/.tmp/grunt/scratch/x.txt"), roots)).toBe(dest);
    expect(rewriteGruntScratchPath(".tmp/grunt/scratch/x.txt", roots)).toBe(dest);
    expect(rewriteGruntScratchPath(path.join(r, ".tmp/grunt/verify/S/.tmp/grunt/x"), roots)).toBeNull();
    expect(rewriteGruntScratchPath(path.join(r, "packages/a/b.tmp/grunt/x"), roots)).toBeNull();
  });

  it("matches below a root that itself sits under some .tmp/grunt", () => {
    const s = path.resolve("/host/.tmp/grunt/verify/S");
    const at = { root: s, checkout: s, cwd: path.join(s, "packages/a") };
    const dest = path.join(s, ".tmp/grunt/scratch/x.txt");
    expect(rewriteGruntScratchPath(path.join(s, "packages/a/.tmp/grunt/scratch/x.txt"), at)).toBe(dest);
    expect(rewriteGruntScratchPath(".tmp/grunt/scratch/x.txt", at)).toBe(dest);
    expect(rewriteGruntScratchPath(path.join(s, "packages/a/notes.md"), at)).toBeNull();
  });

  it("parses Windows paths with path.win32", () => {
    const w = { root: "C:\\r", checkout: "C:\\r", cwd: "C:\\r\\packages\\a" };
    expect(rewriteGruntScratchPath("C:\\r\\packages\\a\\.tmp\\grunt\\x.txt", w, path.win32)).toBe("C:\\r\\.tmp\\grunt\\x.txt");
    expect(rewriteGruntScratchPath(".tmp\\grunt\\x.txt", w, path.win32)).toBe("C:\\r\\.tmp\\grunt\\x.txt");
    expect(rewriteGruntScratchPath("C:\\r\\.tmp\\grunt\\x.txt", w, path.win32)).toBeNull();
  });

  it("leaves a nested plan to orchestrate-parent, records it, and writes no target", () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gate-nested-")));
    tmpDirs.push(ws);
    const a = path.join(ws, "packages/a");
    const call = (file: string) =>
      processFatTools({ workspaceRoot: ws, cwd: a, sessionId: "sid9", toolName: "Write", toolInput: { file_path: file, content: "x" } });
    expect(call(path.join(a, ".tmp/grunt/plans/x.md"))).toBeNull();
    expect(call(path.join(a, ".tmp/grunt/scratch/x.txt"))).toEqual({
      type: "rewrite",
      updatedInput: { file_path: path.join(ws, ".tmp/grunt/scratch/x.txt"), content: "x" },
    });
    const wrote = fs.readFileSync(path.join(ws, ".tmp/grunt/sessions/sid9/wrote.txt"), "utf8").trim().split("\n");
    expect(wrote).toEqual([".tmp/grunt/plans/x.md", ".tmp/grunt/scratch/x.txt"].map((p) => path.join(ws, p).replace(/\\/g, "/")));
    expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
    expect(fs.existsSync(path.join(ws, ".tmp/grunt/scratch"))).toBe(false);
  });
});

describe("every harness", () => {
  const patchAdd = (p: string) => `*** Begin Patch\n*** Add File: ${p}\n+hi\n*** End Patch`;
  const heredoc = (patch: string) => `apply_patch <<'EOF'\n${patch}\nEOF\n`;
  const deniedPath = ["node", "modules/x/package.json"].join("_");

  function repo() {
    const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gate-harness-")));
    tmpDirs.push(r);
    spawnSync("git", ["init", "-q"], { cwd: r });
    const a = path.join(r, "packages/a");
    fs.mkdirSync(a, { recursive: true });
    fs.writeFileSync(path.join(a, "big.log"), "x".repeat(DENY_FILE_BYTES + 1024));
    return { r, a, scratch: (rel: string) => path.join(r, ".tmp/grunt", rel) };
  }
  const codex = (cwd: string, tool_name: string, tool_input: object, extra: object = {}) =>
    processHookPayload({ session_id: "cx1", turn_id: "t1", model: "m", hook_event_name: "PreToolUse", cwd, tool_name, tool_input, ...extra });
  const gemini = (cwd: string, tool_name: string, tool_input: object) =>
    processHookPayload({ session_id: "gm1", hook_event_name: "BeforeTool", cwd, tool_name, tool_input });
  const antigravity = (r: string, name: string, args: object) =>
    processHookPayload({ conversationId: "ag1", workspacePaths: [r], toolCall: { name, args } });
  const codexAllow = (updatedInput: object) => ({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput },
  });
  const claudeDeny = (reason: string) => ({
    decision: "block",
    reason,
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  });

  it("Codex: redirects heredoc and freeform patches with allow, and leaves Update headers", () => {
    const { a, scratch } = repo();
    const rel = ".tmp/grunt/scratch/x.md";
    expect(codex(a, "Bash", { command: heredoc(patchAdd(rel)) })).toEqual(
      codexAllow({ command: heredoc(patchAdd(scratch("scratch/x.md"))) }),
    );
    expect(codex(a, "apply_patch", { command: patchAdd(rel) })).toEqual(codexAllow({ command: patchAdd(scratch("scratch/x.md")) }));
    const update = "*** Begin Patch\n*** Update File: .tmp/grunt/scratch/u.md\n@@\n-a\n+b\n*** End Patch";
    expect(codex(a, "apply_patch", { command: update })).toBeNull();
    expect(codex(a, "Bash", { command: heredoc(patchAdd(rel)) }, { agent_type: "grunt" })).toEqual(
      codexAllow({ command: heredoc(patchAdd(scratch("scratch/x.md"))) }),
    );
    expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
    expect(fs.existsSync(scratch("scratch"))).toBe(false);
  });

  it("Codex: Bash rewrites carry allow and denies keep the Claude body", () => {
    const { a } = repo();
    const out = codex(a, "Bash", { command: "cat big.log" });
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out.hookSpecificOutput.updatedInput.command).toMatch(/grunt-job\.mjs --job exec --query /);
    expect(codex(a, "Bash", { command: `cat ${deniedPath}` })).toEqual(claudeDeny(REASON_DENYLIST));
  });

  it("Codex: every patched path counts as written for the re-read deny", () => {
    const { r, a } = repo();
    fs.writeFileSync(path.join(a, "small.md"), "x\n");
    const patch = "*** Begin Patch\n*** Update File: small.md\n@@\n-x\n+y\n*** Add File: notes/n.md\n+n\n*** End Patch";
    codex(a, "apply_patch", { command: patch });
    for (const file of [path.join(a, "small.md"), path.join(a, "notes/n.md")]) {
      const read = processFatTools({ session_id: "cx1", cwd: a, tool_name: "Read", tool_input: { file_path: file, limit: 10 } });
      expect(read, file).not.toEqual({ type: "deny", reason: REASON_REREAD });
      const whole = processFatTools({ session_id: "cx1", cwd: a, tool_name: "Read", tool_input: { file_path: file } });
      expect(whole, file).toEqual({ type: "deny", reason: REASON_REREAD });
    }
    expect(fs.existsSync(path.join(r, "notes"))).toBe(false);
  });

  it("Gemini: answers rewrites in tool_input and denies with decision", () => {
    const { a, scratch } = repo();
    expect(gemini(a, "write_file", { file_path: path.join(a, ".tmp/grunt/scratch/x.md"), content: "hi" })).toEqual({
      hookSpecificOutput: { hookEventName: "BeforeTool", tool_input: { file_path: scratch("scratch/x.md"), content: "hi" } },
    });
    const shell = gemini(a, "run_shell_command", { command: "cat big.log" });
    expect(shell.hookSpecificOutput.hookEventName).toBe("BeforeTool");
    expect(shell.hookSpecificOutput.tool_input.command).toMatch(/grunt-job\.mjs --job exec --query /);
    expect(gemini(a, "read_file", { file_path: path.join(a, "big.log") })).toEqual({ decision: "deny", reason: REASON_FILE_SIZE });
  });

  it("Antigravity: overwrites only the changed args, denies with decision, and skips its read tools", () => {
    const { r, a, scratch } = repo();
    const target = path.join(a, ".tmp/grunt/scratch/x.md");
    expect(antigravity(r, "write_to_file", { TargetFile: target, CodeContent: "hi", Overwrite: true })).toEqual({
      decision: "allow",
      overwrite: { TargetFile: scratch("scratch/x.md") },
    });
    const run = antigravity(r, "run_command", { CommandLine: "cat big.log", Cwd: a, WaitMsBeforeAsync: 0 });
    expect(run.decision).toBe("allow");
    expect(Object.keys(run.overwrite)).toEqual(["CommandLine"]);
    expect(run.overwrite.CommandLine).toMatch(/grunt-job\.mjs --job exec --query /);
    expect(antigravity(r, "run_command", { CommandLine: `cat ${deniedPath}`, Cwd: a })).toEqual({
      decision: "deny",
      reason: REASON_DENYLIST,
    });
    expect(antigravity(r, "list_dir", { DirectoryPath: r })).toBeNull();
    expect(antigravity(r, "grep_search", { SearchPath: r, Query: "x" })).toBeNull();
    expect(antigravity(r, "view_file", { AbsolutePath: path.join(a, "big.log") })).toBeNull();
    expect(fs.existsSync(scratch("scratch"))).toBe(false);
  });

  it("redirects a nested plan through tools orchestrate-parent cannot see, and leaves Claude's to it", () => {
    const { r, a, scratch } = repo();
    const nested = path.join(a, ".tmp/grunt/plans/p.md");
    expect(codex(a, "apply_patch", { command: patchAdd(nested) })).toEqual(codexAllow({ command: patchAdd(scratch("plans/p.md")) }));
    expect(antigravity(r, "write_to_file", { TargetFile: nested, CodeContent: "x" })).toEqual({
      decision: "allow",
      overwrite: { TargetFile: scratch("plans/p.md") },
    });
    const claude = (tool_name: string, tool_input: object) => processHookPayload({ session_id: "cl1", cwd: a, tool_name, tool_input });
    expect(claude("Write", { file_path: nested, content: "x" })).toBeNull();
    expect(claude("replace_file_content", { file_path: nested, content: "x" })).toBeNull();
  });

  it("parses Windows patch headers and targets with path.win32", () => {
    const w = { root: "C:\\r", checkout: "C:\\r", cwd: "C:\\r\\packages\\a" };
    const nested = "C:\\r\\packages\\a\\.tmp\\grunt\\scratch\\x.md";
    const dest = "C:\\r\\.tmp\\grunt\\scratch\\x.md";
    expect(rewritePatch(patchAdd(nested), w, path.win32).patch).toBe(patchAdd(dest));
    expect(rewriteScratchWrite(nested, w, path.win32)).toBe(dest);
  });
});

describe("nested gitignore guard", () => {
  function repo() {
    const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gate-ignore-")));
    tmpDirs.push(r);
    spawnSync("git", ["init", "-q"], { cwd: r });
    fs.writeFileSync(path.join(r, ".gitignore"), ".tmp/\n*.log\n");
    fs.mkdirSync(path.join(r, "packages/c"), { recursive: true });
    fs.mkdirSync(path.join(r, "packages/a"), { recursive: true });
    fs.writeFileSync(path.join(r, "packages/c/.gitignore"), "dist-local/\n");
    return r;
  }
  const claude = (r: string, tool_name: string, tool_input: object, extra: object = {}) =>
    processHookPayload({ session_id: "ig", hook_event_name: "PreToolUse", cwd: r, tool_name, tool_input, ...extra });
  const codex = (r: string, tool_name: string, tool_input: object) =>
    processHookPayload({ session_id: "ig", turn_id: "t", model: "m", hook_event_name: "PreToolUse", cwd: r, tool_name, tool_input });
  const gemini = (r: string, tool_name: string, tool_input: object) =>
    processHookPayload({ session_id: "ig", hook_event_name: "BeforeTool", cwd: r, tool_name, tool_input });
  const antigravity = (r: string, name: string, args: object) =>
    processHookPayload({ conversationId: "ig", workspacePaths: [r], toolCall: { name, args } });
  const hookDeny = (out: any) => out?.hookSpecificOutput?.permissionDecision === "deny" && out.hookSpecificOutput.permissionDecisionReason;
  const decisionDeny = (out: any) => out?.decision === "deny" && out.reason;
  const addC = { old_string: "dist-local/\n", new_string: "dist-local/\n.tmp/\n" };
  const heredoc = "cat <<'EOF' >> packages/a/.gitignore\n.tmp/\nEOF";
  const patchAddA = "*** Begin Patch\n*** Add File: packages/a/.gitignore\n+.tmp/\n*** End Patch\n";
  const patchUpdateC = "*** Begin Patch\n*** Update File: packages/c/.gitignore\n@@\n dist-local/\n+.tmp/\n*** End Patch\n";

  it("denies a redundant nested line in every harness's shape, naming the parent rule", () => {
    const r = repo();
    const rule = `${path.join(r, ".gitignore")}:1 .tmp/`;
    const a = path.join(r, "packages/a/.gitignore");
    const c = path.join(r, "packages/c/.gitignore");
    const hook = [
      claude(r, "Write", { file_path: a, content: ".tmp/\n" }),
      claude(r, "Edit", { file_path: c, ...addC }),
      claude(r, "Bash", { command: heredoc }),
      claude(r, "Bash", { command: heredoc }, { agent_type: "grunt" }),
      codex(r, "apply_patch", { command: patchAddA }),
      codex(r, "Bash", { command: `apply_patch <<'EOF'\n${patchUpdateC}EOF\n` }),
    ];
    for (const [i, out] of hook.entries()) expect(hookDeny(out), String(i)).toContain(rule);
    const decision = [
      gemini(r, "write_file", { file_path: "packages/a/.gitignore", content: ".tmp/\n" }),
      gemini(r, "replace", { file_path: c, ...addC }),
      gemini(r, "run_shell_command", { command: "echo .tmp/ > .gitignore", dir_path: "packages/a" }),
      antigravity(r, "write_to_file", { TargetFile: a, CodeContent: ".tmp/\n" }),
      antigravity(r, "replace_file_content", { TargetFile: c, TargetContent: "dist-local/\n", ReplacementContent: "dist-local/\n.tmp/\n" }),
      antigravity(r, "multi_replace_file_content", { TargetFile: c, ReplacementChunks: [{ TargetContent: "dist-local/\n", ReplacementContent: "dist-local/\n.tmp/\n" }] }),
      antigravity(r, "run_command", { CommandLine: "echo .tmp/ > .gitignore", Cwd: path.join(r, "packages/a") }),
    ];
    for (const [i, out] of decision.entries()) expect(decisionDeny(out), String(i)).toContain(rule);
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.readFileSync(c, "utf8")).toBe("dist-local/\n");
  });

  it("passes lines the parents miss, the root file, globs and other shell forms", () => {
    const r = repo();
    const outs = [
      claude(r, "Write", { file_path: path.join(r, "packages/a/.gitignore"), content: "dist-local/\n" }),
      claude(r, "Write", { file_path: path.join(r, ".gitignore"), content: ".tmp/\n*.log\n.tmp/\n" }),
      claude(r, "Write", { file_path: path.join(r, "packages/a/.gitignore"), content: "*.log\n" }),
      claude(r, "Bash", { command: "cd packages/a && echo .tmp/ >> .gitignore" }),
    ];
    for (const [i, out] of outs.entries()) expect(JSON.stringify(out ?? null), String(i)).not.toMatch(/redundant \.gitignore/);
    expect(fs.existsSync(path.join(r, "packages/a/.gitignore"))).toBe(false);
  });
});
