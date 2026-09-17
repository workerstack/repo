import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
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
  denyResponse,
  hookResponse,
  hasChildAgentMarker,
  isParentOrchestrator,
  subagentTypeOf,
  pathIsDenied,
  processFatTools,
  processHookPayload,
  rewriteGruntScratchPath,
  rewriteScratchWrite,
} from "./gate-fat-tools.mjs";
import {
  DENY_REASON,
  ORCHESTRATOR_LOGS_DIR,
} from "../.grok/hooks/orchestrate-parent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const gate = path.join(here, "gate-fat-tools.mjs");
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
    fs.mkdirSync(path.join(ws, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(ws, "scripts/grunt-job.mjs"), "");
    expect(
      processFatTools({
        subagentType: "implementer",
        workspaceRoot: ws,
        toolName: "Bash",
        toolInput: {
          command: "node scripts/grunt-job.mjs --job test --query npm test",
        },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        subagentType: "implementer",
        workspaceRoot: ws,
        toolName: "Bash",
        toolInput: {
          command: "node scripts/grunt-job.mjs --job search --query foo|bar",
        },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        subagentType: "implementer",
        workspaceRoot: ws,
        toolName: "Bash",
        toolInput: {
          command: "node scripts/grunt-job.mjs --job exec --query true",
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
    const result = runHook(gate, {
      hookEventName: "PreToolUse",
      toolName: "grep",
      toolInput: { pattern: "x", path: "node_modules" },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(denyResponse(REASON_DENYLIST));
  });

  it("emits updatedInput for missing grep limit", () => {
    const result = runHook(gate, {
      tool_name: "Grep",
      tool_input: { pattern: "foo" },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      hookResponse({ pattern: "foo", head_limit: DEFAULT_GREP_HEAD_LIMIT }),
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
    expect(JSON.parse(result.stdout).decision).toBe("deny");
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
      rewriteGruntScratchPath("/tmp/host/.tmp/grunt/notes.md", ws),
    ).toBe(path.join(ws, ".tmp/grunt/notes.md"));
    expect(
      rewriteGruntScratchPath("/var/foo/.tmp/grunt/handoffs/draft.md", ws),
    ).toBe(path.join(ws, ".tmp/grunt/handoffs/draft.md"));
  });

  it("rejects empty, .., and escaped rel", () => {
    expect(rewriteGruntScratchPath("", ws)).toBeNull();
    expect(rewriteGruntScratchPath("/tmp/x/.tmp/grunt/", ws)).toBeNull();
    expect(
      rewriteGruntScratchPath("/tmp/x/.tmp/grunt/../../etc/passwd", ws),
    ).toBeNull();
    expect(
      rewriteGruntScratchPath("/tmp/x/.tmp/grunt/../escape.md", ws),
    ).toBeNull();
    expect(rewriteGruntScratchPath("/tmp/x/.tmp/grunt//abs", ws)).not.toBe(
      "/abs",
    );
  });

  it("does not rewrite in-workspace paths or non-scratch", () => {
    expect(
      rewriteGruntScratchPath(path.join(ws, ".tmp/grunt/notes.md"), ws),
    ).toBeNull();
    expect(rewriteGruntScratchPath(path.join(ws, "src/index.ts"), ws)).toBeNull();
    expect(rewriteGruntScratchPath("src/index.ts", ws)).toBeNull();
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
    const outside = "/tmp/host/.tmp/grunt/notes.md";
    const dest = path.join(ws, ".tmp/grunt/notes.md");
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
    expect(rewriteScratchWrite("notes.md", ws)).toBe(
      path.join(ws, ".tmp", "grunt", "notes.md"),
    );
    expect(rewriteScratchWrite("README.md", ws)).toBeNull();
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
});

