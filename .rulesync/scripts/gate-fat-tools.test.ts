import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { aliasOf } from "../../dev/test-paths";
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
  REASON_REREAD,
  bashTargetsDenylist,
  harnessOf,
  answerDeny,
  answerRewrite,
  hasChildAgentMarker,
  isParentOrchestrator,
  sessionIdOf,
  subagentTypeOf,
  pathIsDenied,
  processFatTools,
  processHookPayload,
  rewriteScratchPath,
  rewritePatch,
  rewriteScratchWrite,
  isImplementer,
  isOutsideRootTmp,
  jobCommand,
} from "./gate-fat-tools.mjs";
import { ENFORCED_HARNESSES, activeReview, stampPath, writeStamp } from "./strategy.mjs";
import { mainCheckoutWriteReason } from "./worktree.mjs";
import { VALID_PLAN } from "./fixtures/persist-bodies.mjs";
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
    fs.rmSync(`${d}-alias`, { force: true });
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
    expect(pathIsDenied("bun.lock")).toBe(true);
    expect(pathIsDenied("apps/web/bun.lock")).toBe(true);
    expect(pathIsDenied(".git/objects/pack")).toBe(true);
    expect(pathIsDenied("src/index.ts")).toBe(false);
    expect(pathIsDenied(".gitignore")).toBe(false);
    expect(pathIsDenied(".github/workflows/ci.yml")).toBe(false);
  });
});

describe("bashTargetsDenylist", () => {
  it("catches cat/rg/find on denylist paths, not cargo build", () => {
    expect(bashTargetsDenylist("cat bun.lock")).toBe(true);
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
    expect(isParentOrchestrator({ subagentType: "explore" })).toBe(false);
    expect(isParentOrchestrator({ subagent_type: "thinker" })).toBe(false);
    expect(isParentOrchestrator({ agentType: "scout" })).toBe(false);
    expect(isParentOrchestrator({ agent_type: "explore" })).toBe(false);
    expect(isParentOrchestrator({ agentId: "explore" })).toBe(false);
    expect(isParentOrchestrator({ agent_id: "thinker" })).toBe(false);
    expect(isParentOrchestrator({ spawnedBy: "repo" })).toBe(false);
    expect(isParentOrchestrator({ spawned_by: "explore" })).toBe(false);
    expect(
      isParentOrchestrator({
        agentId: "b2c6f0d4-0000-4000-8000-000000000000",
      }),
    ).toBe(false);
    expect(hasChildAgentMarker({ agentId: "b2c6f0d4-0000-4000-8000-000000000000" })).toBe(
      true,
    );
    expect(hasChildAgentMarker({})).toBe(false);
    expect(isParentOrchestrator({ agent: { type: "explore" } })).toBe(false);
    expect(subagentTypeOf({ agent_id: "explore" })).toBe("explore");
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
        toolInput: { file_path: "bun.lock" },
      }),
    ).toEqual({ type: "deny", reason: REASON_DENYLIST });
  });

  it("injects 150/400 for an unknown child; scout is unscoped", () => {
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
    const file = tmpFile(100, "child-small.txt");
    expect(
      processFatTools({
        subagentType: "explore",
        toolName: "read_file",
        toolInput: { target_file: file },
      }),
    ).toEqual({
      type: "rewrite",
      updatedInput: { target_file: file, limit: CHILD_READ_LIMIT },
    });
    expect(
      processFatTools({
        subagentType: "scout",
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

  it("denies child files larger than 200KB", () => {
    const file = tmpFile(DENY_FILE_BYTES + 1, "child-huge.bin");
    expect(
      processFatTools({
        subagentType: "explore",
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

  it("denies a child's path denylist and fat bash", () => {
    expect(
      processFatTools({
        subagentType: "explore",
        toolName: "read_file",
        toolInput: { target_file: "bun.lock" },
      }),
    ).toEqual({ type: "deny", reason: REASON_DENYLIST });
    expect(
      processFatTools({
        subagent_type: "explore",
        toolName: "run_terminal_command",
        toolInput: { command: "cat node_modules/x" },
      }),
    ).toEqual({ type: "deny", reason: REASON_DENYLIST });
    expect(
      processFatTools({
        subagentType: "explore",
        toolName: "Bash",
        toolInput: { command: "curl https://example.com" },
      })?.type,
    ).toBe("rewrite");
    expect(
      processFatTools({
        subagentType: "explore",
        toolName: "Bash",
        toolInput: { command: "rtk bun test --ultra-compact" },
      }),
    ).toBeNull();
  });

  it("allows a child's workspace job search|exec|test", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-fat-gj-"));
    tmpDirs.push(ws);
    fs.mkdirSync(path.join(ws, ".rulesync", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".rulesync/scripts/job.mjs"), "");
    expect(
      processFatTools({
        subagentType: "explore",
        workspaceRoot: ws,
        toolName: "Bash",
        toolInput: {
          command: "node .rulesync/scripts/job.mjs --job test --query bun run test",
        },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        subagentType: "explore",
        workspaceRoot: ws,
        toolName: "Bash",
        toolInput: {
          command: "node .rulesync/scripts/job.mjs --job search --query foo|bar",
        },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        subagentType: "explore",
        workspaceRoot: ws,
        toolName: "Bash",
        toolInput: {
          command: "node .rulesync/scripts/job.mjs --job exec --query true",
        },
      }),
    ).toBeNull();
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

describe("rewriteScratchPath", () => {
  const ws = "/home/ecomet/Development/repo-test-2";

  it("rewrites outside-ws */.tmp/repo/* into workspace scratch", () => {
    expect(
      rewriteScratchPath("/tmp/host/.tmp/repo/notes.md", R(ws)),
    ).toBe(path.resolve(ws, ".tmp/repo/notes.md"));
    expect(
      rewriteScratchPath("/var/foo/.tmp/repo/handoffs/draft.md", R(ws)),
    ).toBe(path.resolve(ws, ".tmp/repo/handoffs/draft.md"));
  });

  it("rejects empty, .., and escaped rel", () => {
    expect(rewriteScratchPath("", R(ws))).toBeNull();
    expect(rewriteScratchPath("/tmp/x/.tmp/repo/", R(ws))).toBeNull();
    expect(
      rewriteScratchPath("/tmp/x/.tmp/repo/../../etc/passwd", R(ws)),
    ).toBeNull();
    expect(
      rewriteScratchPath("/tmp/x/.tmp/repo/../escape.md", R(ws)),
    ).toBeNull();
    expect(rewriteScratchPath("/tmp/x/.tmp/repo//abs", R(ws))).not.toBe(
      "/abs",
    );
  });

  it("does not rewrite in-workspace paths or non-scratch", () => {
    expect(
      rewriteScratchPath(path.join(ws, ".tmp/repo/notes.md"), R(ws)),
    ).toBeNull();
    expect(rewriteScratchPath(path.join(ws, "src/index.ts"), R(ws))).toBeNull();
    expect(rewriteScratchPath("src/index.ts", R(ws))).toBeNull();
  });
});

describe("processFatTools plan write-allowlist", () => {
  function writePlan(ws: string, status: string, listed: string) {
    const plans = path.join(ws, ".tmp", "repo", "plans");
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
        subagentType: "scout",
        workspaceRoot: ws,
        toolName: "Write",
        toolInput: { file_path: listed, content: "ok" },
      }),
    ).toBeNull();
    expect(
      processFatTools({
        subagentType: "scout",
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
  const ws = "/home/ecomet/Development/repo-test-2";

  it("rewrites Write/Edit/write/search_replace path fields and never denies", () => {
    const outside = "/tmp/host/.tmp/repo/scratch/notes.md";
    const dest = path.resolve(ws, ".tmp/repo/scratch/notes.md");
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
      const out = processFatTools({ toolName: "Write", toolInput: { file_path: `/tmp/host/.tmp/repo/${rel}`, content: "x" }, workspaceRoot: ws });
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
          file_path: "/tmp/x/.tmp/repo/../../etc/passwd",
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

  it("repo remains unscoped", () => {
    expect(
      processFatTools({
        subagentType: "scout",
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
      path.join(ws, ".tmp", "repo", "notes.md"),
    );
    expect(rewriteScratchWrite("README.md", R(ws))).toBeNull();
    const out = processFatTools({
      workspaceRoot: ws,
      toolName: "Write",
      toolInput: { file_path: "notes.md", content: "x" },
    });
    expect(out?.type).toBe("rewrite");
    expect((out as { updatedInput: { file_path: string } }).updatedInput.file_path).toBe(
      path.join(ws, ".tmp", "repo", "notes.md"),
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

  it("rewrites bash dump to job and ls to rtk", () => {
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
    ).toMatch(/job\.mjs --job exec --query /);
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

  it("sends a nested or worktree .tmp/repo Write to the root's", () => {
    const dest = path.join(r, ".tmp/repo/scratch/x.txt");
    expect(rewriteScratchPath(path.join(r, "packages/a/.tmp/repo/scratch/x.txt"), roots)).toBe(dest);
    expect(rewriteScratchPath(path.join(r, ".worktrees/w/.tmp/repo/scratch/x.txt"), roots)).toBe(dest);
    expect(rewriteScratchPath(".tmp/repo/scratch/x.txt", roots)).toBe(dest);
    expect(rewriteScratchPath(path.join(r, ".tmp/repo/verify/S/.tmp/repo/x"), roots)).toBeNull();
    expect(rewriteScratchPath(path.join(r, "packages/a/b.tmp/repo/x"), roots)).toBeNull();
  });

  it("matches below a root that itself sits under some .tmp/repo", () => {
    const s = path.resolve("/host/.tmp/repo/verify/S");
    const at = { root: s, checkout: s, cwd: path.join(s, "packages/a") };
    const dest = path.join(s, ".tmp/repo/scratch/x.txt");
    expect(rewriteScratchPath(path.join(s, "packages/a/.tmp/repo/scratch/x.txt"), at)).toBe(dest);
    expect(rewriteScratchPath(".tmp/repo/scratch/x.txt", at)).toBe(dest);
    expect(rewriteScratchPath(path.join(s, "packages/a/notes.md"), at)).toBeNull();
  });

  it("parses Windows paths with path.win32", () => {
    const w = { root: "C:\\r", checkout: "C:\\r", cwd: "C:\\r\\packages\\a" };
    expect(rewriteScratchPath("C:\\r\\packages\\a\\.tmp\\repo\\x.txt", w, path.win32)).toBe("C:\\r\\.tmp\\repo\\x.txt");
    expect(rewriteScratchPath(".tmp\\repo\\x.txt", w, path.win32)).toBe("C:\\r\\.tmp\\repo\\x.txt");
    expect(rewriteScratchPath("C:\\r\\.tmp\\repo\\x.txt", w, path.win32)).toBeNull();
  });

  it("leaves a nested plan to orchestrate-parent, records it, and writes no target", () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gate-nested-")));
    tmpDirs.push(ws);
    const a = path.join(ws, "packages/a");
    const call = (file: string) =>
      processFatTools({ workspaceRoot: ws, cwd: a, sessionId: "sid9", toolName: "Write", toolInput: { file_path: file, content: "x" } });
    expect(call(path.join(a, ".tmp/repo/plans/x.md"))).toBeNull();
    expect(call(path.join(a, ".tmp/repo/scratch/x.txt"))).toEqual({
      type: "rewrite",
      updatedInput: { file_path: path.join(ws, ".tmp/repo/scratch/x.txt"), content: "x" },
    });
    const wrote = fs.readFileSync(path.join(ws, ".tmp/repo/sessions/sid9/wrote.txt"), "utf8").trim().split("\n");
    expect(wrote).toEqual([".tmp/repo/plans/x.md", ".tmp/repo/scratch/x.txt"].map((p) => path.join(ws, p).replace(/\\/g, "/")));
    expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
    expect(fs.existsSync(path.join(ws, ".tmp/repo/scratch"))).toBe(false);
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
    return { r, a, scratch: (rel: string) => path.join(r, ".tmp/repo", rel) };
  }
  const codex = (cwd: string, tool_name: string, tool_input: object, extra: object = {}) =>
    processHookPayload({ session_id: "cx1", turn_id: "t1", model: "m", hook_event_name: "PreToolUse", cwd, tool_name, tool_input, ...extra });
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
    const rel = ".tmp/repo/scratch/x.md";
    expect(codex(a, "Bash", { command: heredoc(patchAdd(rel)) })).toEqual(
      codexAllow({ command: heredoc(patchAdd(scratch("scratch/x.md"))) }),
    );
    expect(codex(a, "apply_patch", { command: patchAdd(rel) })).toEqual(codexAllow({ command: patchAdd(scratch("scratch/x.md")) }));
    const update = "*** Begin Patch\n*** Update File: .tmp/repo/scratch/u.md\n@@\n-a\n+b\n*** End Patch";
    expect(codex(a, "apply_patch", { command: update })).toBeNull();
    expect(codex(a, "Bash", { command: heredoc(patchAdd(rel)) }, { agent_type: "scout" })).toEqual(
      codexAllow({ command: heredoc(patchAdd(scratch("scratch/x.md"))) }),
    );
    expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
    expect(fs.existsSync(scratch("scratch"))).toBe(false);
  });

  it("Codex: Bash rewrites carry allow and denies keep the Claude body", () => {
    const { a } = repo();
    const out = codex(a, "Bash", { command: "cat big.log" });
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out.hookSpecificOutput.updatedInput.command).toMatch(/job\.mjs --job exec --query /);
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

  it("counts a write made through an alias of the repo for the re-read deny in either spelling", () => {
    const { r } = repo();
    const alias = path.join(aliasOf(r), "packages/a");
    for (const [sid, extra] of [["al1", {}], ["al2", { agent_type: "scout" }]] as const) {
      fs.writeFileSync(path.join(r, "packages/a/small.md"), "x\n");
      codex(alias, "apply_patch", { command: "*** Begin Patch\n*** Update File: small.md\n@@\n-x\n+y\n*** End Patch" }, { session_id: sid, ...extra });
      for (const [cwd, file] of [[r, path.join(r, "packages/a/small.md")], [alias, path.join(alias, "small.md")], [alias, "small.md"]]) {
        const whole = processFatTools({ session_id: sid, cwd, tool_name: "Read", tool_input: { file_path: file } });
        expect(whole, `${sid} ${file}`).toEqual({ type: "deny", reason: REASON_REREAD });
      }
    }
  });

  it("Antigravity: overwrites only the changed args, denies with decision, and skips its read tools", () => {
    const { r, a, scratch } = repo();
    const target = path.join(a, ".tmp/repo/scratch/x.md");
    expect(antigravity(r, "write_to_file", { TargetFile: target, CodeContent: "hi", Overwrite: true })).toEqual({
      decision: "allow",
      overwrite: { TargetFile: scratch("scratch/x.md") },
    });
    const run = antigravity(r, "run_command", { CommandLine: "cat big.log", Cwd: a, WaitMsBeforeAsync: 0 });
    expect(run.decision).toBe("allow");
    expect(Object.keys(run.overwrite)).toEqual(["CommandLine"]);
    expect(run.overwrite.CommandLine).toMatch(/job\.mjs --job exec --query /);
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
    const nested = path.join(a, ".tmp/repo/plans/p.md");
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
    const nested = "C:\\r\\packages\\a\\.tmp\\repo\\scratch\\x.md";
    const dest = "C:\\r\\.tmp\\repo\\scratch\\x.md";
    expect(rewritePatch(patchAdd(nested), w, path.win32).patch).toBe(patchAdd(dest));
    expect(rewriteScratchWrite(nested, w, path.win32)).toBe(dest);
  });
});

describe("Cursor", () => {
  const deniedPath = ["node", "modules/x/package.json"].join("_");
  function repo() {
    const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gate-cursor-")));
    tmpDirs.push(r);
    spawnSync("git", ["init", "-q"], { cwd: r });
    fs.writeFileSync(path.join(r, ".gitignore"), ".tmp/\n");
    const a = path.join(r, "packages/a");
    fs.mkdirSync(a, { recursive: true });
    fs.writeFileSync(path.join(a, "big.log"), "x".repeat(DENY_FILE_BYTES + 1024));
    fs.writeFileSync(path.join(a, "small.md"), "x\n");
    return { r, a, scratch: (rel: string) => path.join(r, ".tmp/repo", rel) };
  }
  const payload = (cwd: string, tool_name: string, tool_input: object, extra: object = {}) => ({
    cursor_version: "2026.11.05",
    session_id: "cu1",
    model: "m",
    cwd,
    tool_name,
    tool_input,
    ...extra,
  });
  const cursor = (cwd: string, tool_name: string, tool_input: object, extra: object = {}) =>
    processHookPayload(payload(cwd, tool_name, tool_input, extra));
  const denial = (reason: string | RegExp) => ({
    permission: "deny",
    user_message: typeof reason === "string" ? reason : expect.stringMatching(reason),
    agent_message: typeof reason === "string" ? reason : expect.stringMatching(reason),
  });

  it("detects a string cursor_version before every other shape", () => {
    expect(harnessOf({ cursor_version: "2026.11.05", tool_name: "Shell" })).toBe("cursor");
    expect(harnessOf({ cursor_version: "2026.11.05", turn_id: "t", model: "m" })).toBe("cursor");
    expect(harnessOf({ cursor_version: "2026.11.05", toolCall: { name: "x", args: {} } })).toBe("cursor");
    expect(harnessOf({ cursor_version: 3, model: "m" })).toBe("claude");
    expect(harnessOf({ session_id: "s", model: "m" })).toBe("claude");
  });

  it("denies a Shell dump of a denylisted path in Cursor's reply shape", () => {
    const { a } = repo();
    expect(cursor(a, "Shell", { command: "cat bun.lock", cwd: a })).toEqual(denial(REASON_DENYLIST));
    expect(cursor(a, "Shell", { command: `cat ${deniedPath}` })).toEqual(denial(REASON_DENYLIST));
    expect(cursor(a, "Shell", { command: "curl" })).toEqual(denial(REASON_DENYLIST));
  });

  it("rewrites a Shell dump, a web fetch and ls in the nested form, never with permission", () => {
    const { a } = repo();
    const next = (command: string) => (cursor(a, "Shell", { command }) as any).hookSpecificOutput;
    expect(next("cat small.md")).toMatchObject({ hookEventName: "PreToolUse", updatedInput: { command: expect.stringMatching(/job\.mjs --job exec --query /) } });
    expect(next("curl https://example.com/x").updatedInput.command).toMatch(/job\.mjs --job fetch --query /);
    expect(next("ls src").updatedInput).toEqual({ command: "rtk ls src" });
    for (const command of ["cat small.md", "ls src"]) {
      const out = cursor(a, "Shell", { command }) as any;
      expect(Object.keys(out)).toEqual(["hookSpecificOutput"]);
      expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
    }
    expect(cursor(a, "Shell", { command: "git status" })).toBeNull();
  });

  it("redirects a nested Write to the root scratch with no permission field", () => {
    const { r, a, scratch } = repo();
    const typed = path.join(a, ".tmp/repo/scratch/x.md");
    expect(cursor(a, "Write", { file_path: typed, content: "hi" })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { file_path: scratch("scratch/x.md"), content: "hi" } },
    });
    expect(cursor(r, "Write", { file_path: "notes.md", content: "hi" })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { file_path: scratch("notes.md"), content: "hi" } },
    });
    expect(cursor(a, "Write", { file_path: path.join(a, "src.ts"), content: "hi" })).toBeNull();
    expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
    expect(fs.existsSync(path.join(r, ".tmp/repo/scratch"))).toBe(false);
  });

  it("denies Read and Grep on a denylisted path and Read of a file over 200KB", () => {
    const { a } = repo();
    expect(cursor(a, "Read", { file_path: deniedPath })).toEqual(denial(REASON_DENYLIST));
    expect(cursor(a, "Read", { file_path: "bun.lock" })).toEqual(denial(REASON_DENYLIST));
    expect(cursor(a, "Grep", { pattern: "x", file_path: "dist" })).toEqual(denial(REASON_DENYLIST));
    expect(cursor(a, "Grep", { pattern: "x", glob: "node_modules/**" })).toEqual(denial(REASON_DENYLIST));
    expect(cursor(a, "Read", { file_path: path.join(a, "big.log") })).toEqual(denial(REASON_FILE_SIZE));
  });

  it("injects no limit into Read or Grep, which Cursor cannot take", () => {
    const { a } = repo();
    expect(cursor(a, "Read", { file_path: path.join(a, "small.md") })).toBeNull();
    expect(cursor(a, "Grep", { pattern: "x", file_path: "src" })).toBeNull();
    expect(cursor(a, "Grep", { pattern: "x", head_limit: 9999 })).toBeNull();
  });

  it("denies a Read of a file this session wrote with a reason that works without offset or limit", () => {
    const { a } = repo();
    const file = path.join(a, "small.md");
    expect(cursor(a, "Write", { file_path: file, content: "x\n" })).toBeNull();
    const out = cursor(a, "Read", { file_path: file }) as any;
    expect(out.permission).toBe("deny");
    expect(out.user_message).toBe(out.agent_message);
    expect(out.user_message).toMatch(/already wrote this session/);
    expect(out.user_message).toMatch(/job\.mjs --job exec --query 'sed -n 1,200p /);
    expect(out.user_message).not.toContain(REASON_REREAD);
    expect(out.user_message).toContain(file);
    expect(cursor(a, "Read", { file_path: file }, { session_id: "other" })).toBeNull();
  });

  it("holds every deny guard for Cursor payloads", () => {
    const { r, a } = repo();
    const c = path.join(r, "packages/c/.gitignore");
    fs.mkdirSync(path.dirname(c), { recursive: true });
    const nested = path.join(a, ".gitignore");
    const rule = `${path.join(r, ".gitignore")}:1 .tmp/`;
    for (const out of [
      cursor(a, "Write", { file_path: nested, content: ".tmp/\n" }),
      cursor(a, "Shell", { command: "echo .tmp/ > .gitignore", cwd: a }),
    ] as any[]) {
      expect(out.permission).toBe("deny");
      expect(out.agent_message).toContain(rule);
    }
    const wt = cursor(r, "Shell", { command: "git worktree add ../elsewhere" }) as any;
    expect(wt).toEqual(denial(/^worktrees live in .*[\\/]\.worktrees[\\/]<name> on branch wt\/<name>: run node /));
    expect(cursor(r, "Shell", { command: "git worktree add .worktrees/y -b wt/y" })).toBeNull();
    expect(fs.existsSync(nested)).toBe(false);
  });

  it("skips tools it does not answer", () => {
    const { a } = repo();
    for (const name of ["List", "Delete", "Glob", "Bash"]) expect(cursor(a, name, { file_path: "node_modules" })).toBeNull();
  });

  it("answers on stdout in the same shape and stays silent on a pass", () => {
    const { a } = repo();
    const data = payload(a, "Shell", { command: "cat bun.lock", cwd: a });
    const out = runHook(gate, data, { CLAUDE_PROJECT_DIR: "", GROK_WORKSPACE_ROOT: "" });
    expect(out.status).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual(answerDeny(data, REASON_DENYLIST));
    expect(JSON.parse(out.stdout)).toEqual(denial(REASON_DENYLIST));
    const pass = runHook(gate, payload(a, "Shell", { command: "git status" }), { CLAUDE_PROJECT_DIR: "", GROK_WORKSPACE_ROOT: "" });
    expect(pass.status).toBe(0);
    expect(pass.stdout).toBe("");
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
      claude(r, "Bash", { command: heredoc }, { agent_type: "scout" }),
      codex(r, "apply_patch", { command: patchAddA }),
      codex(r, "Bash", { command: `apply_patch <<'EOF'\n${patchUpdateC}EOF\n` }),
    ];
    for (const [i, out] of hook.entries()) expect(hookDeny(out), String(i)).toContain(rule);
    const decision = [
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

/** A git repo with one commit and a worktree `.worktrees/a`, so the main-checkout guard is live. */
function committedRepo(prefix = "gate-main-") {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(r);
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: r, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(r, ".gitignore"), ".tmp/\n.worktrees/\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  git("worktree", "add", "-q", "-b", "wt/a", path.join(r, ".worktrees", "a"));
  return r;
}

describe("main checkout guard", () => {
  const SID = "mc1";
  const reasonOf = (r: string) =>
    `the main checkout is shared: run node ${path.join(r, ".rulesync", "scripts", "worktree.mjs")} add <name> and write under ${path.join(r, ".worktrees", "<name>")}; only ${path.join(r, ".tmp")}${path.sep} is writable here`;
  const deny = (reason: string) => ({ type: "deny", reason });
  const patchOf = (file: string) => `*** Begin Patch\n*** Add File: ${file}\n+x\n*** End Patch`;
  const claudeWrite = (cwd: string, file: string, extra: object = {}) => ({ session_id: SID, cwd, tool_name: "Write", tool_input: { file_path: file, content: "x" }, ...extra });
  const codexPatch = (cwd: string, file: string, extra: object = {}) => ({ session_id: SID, turn_id: "t", model: "m", cwd, tool_name: "apply_patch", tool_input: { command: patchOf(file) }, ...extra });
  const cursorWrite = (cwd: string, file: string) => ({ cursor_version: "2026.11.05", session_id: SID, model: "m", cwd, tool_name: "Write", tool_input: { file_path: file, content: "x" } });
  const claudeSh = (cwd: string, command: string, extra: object = {}) => ({ session_id: SID, cwd, tool_name: "Bash", tool_input: { command }, ...extra });
  const cursorSh = (cwd: string, command: string) => ({ cursor_version: "2026.11.05", session_id: SID, model: "m", cwd, tool_name: "Shell", tool_input: { command } });
  const askedFile = (r: string) => path.join(r, ".tmp/repo/sessions", SID, "git-asked.json");
  const ask = (r: string, text: string) => {
    fs.mkdirSync(path.dirname(askedFile(r)), { recursive: true });
    fs.writeFileSync(askedFile(r), text);
  };

  it("denies a product write in the main checkout from a parent, a scout child and an implementer", () => {
    const r = committedRepo();
    const file = path.join(r, "src/x.ts");
    for (const extra of [{}, { agent_type: "scout" }, { agent_type: "implementer-fast" }]) {
      expect(processFatTools(claudeWrite(r, file, extra)), JSON.stringify(extra)).toEqual(deny(reasonOf(r)));
      expect(processFatTools(claudeWrite(r, "src/x.ts", extra)), `relative ${JSON.stringify(extra)}`).toEqual(deny(reasonOf(r)));
    }
    const edit = { session_id: SID, cwd: r, tool_name: "Edit", tool_input: { file_path: file, old_string: "a", new_string: "b" } };
    expect(processFatTools(edit)).toEqual(deny(reasonOf(r)));
  });

  it("denies a Codex apply_patch (tool and shell heredoc), a Cursor Write and an Antigravity edit", () => {
    const r = committedRepo();
    const file = path.join(r, "src/x.ts");
    expect(processFatTools(codexPatch(r, file))).toEqual(deny(reasonOf(r)));
    expect(processFatTools(codexPatch(r, file, { agent_type: "scout" }))).toEqual(deny(reasonOf(r)));
    const update = codexPatch(r, file);
    update.tool_input.command = `*** Begin Patch\n*** Update File: ${file}\n@@\n-a\n+b\n*** End Patch`;
    expect(processFatTools(update)).toEqual(deny(reasonOf(r)));
    const heredoc = claudeSh(r, `apply_patch <<'EOF'\n${patchOf(file)}\nEOF\n`, { turn_id: "t", model: "m" });
    expect(processFatTools(heredoc)).toEqual(deny(reasonOf(r)));
    expect(processFatTools(cursorWrite(r, file))).toEqual({ type: "deny", reason: reasonOf(r) });
    const agy = { conversationId: "c1", workspacePaths: [r], toolCall: { name: "replace_file_content", args: { TargetFile: file, TargetContent: "a", ReplacementContent: "b" } } };
    expect(processFatTools(agy)).toEqual(deny(reasonOf(r)));
    // The reply shape of each harness carries the reason.
    expect(processHookPayload(cursorWrite(r, file))).toMatchObject({ permission: "deny", agent_message: reasonOf(r) });
    expect(processHookPayload(codexPatch(r, file))).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: reasonOf(r) } });
  });

  it("lets .tmp, a worktree, scratch redirects and paths outside the root through", () => {
    const r = committedRepo();
    const outside = path.join(os.tmpdir(), "gate-main-elsewhere", "x.ts");
    for (const file of [
      path.join(r, ".tmp/repo/n.md"),
      path.join(r, ".tmp/x.txt"),
      path.join(r, ".worktrees/a/src/x.ts"),
      path.join(r, "packages/a/.tmp/repo/x.md"),
      path.join(r, "tmp/notes.md"),
      outside,
    ]) {
      expect(processFatTools(claudeWrite(r, file))?.type, file).not.toBe("deny");
      expect(processFatTools(codexPatch(r, file))?.type, `codex ${file}`).not.toBe("deny");
      expect(processFatTools(cursorWrite(r, file))?.type, `cursor ${file}`).not.toBe("deny");
      expect(processFatTools(claudeWrite(r, file, { agent_type: "scout" }))?.type, `scout ${file}`).not.toBe("deny");
    }
    // A shell run in a worktree can write there too: the guard reads the write tools, not the cwd.
    expect(processFatTools(claudeWrite(path.join(r, ".worktrees/a"), "src/x.ts"))?.type).not.toBe("deny");
  });

  it("judges the canonical path through a symlink to the root", () => {
    const r = committedRepo();
    const alias = aliasOf(r);
    expect(processFatTools(claudeWrite(alias, path.join(alias, "src/x.ts")))).toEqual(deny(reasonOf(r)));
    expect(processFatTools(claudeWrite(r, path.join(alias, "src/x.ts")))).toEqual(deny(reasonOf(r)));
    expect(processFatTools(claudeWrite(alias, path.join(alias, ".worktrees/a/src/x.ts")))?.type).not.toBe("deny");
    expect(processFatTools(claudeWrite(alias, path.join(alias, ".tmp/repo/n.md")))?.type).not.toBe("deny");
    expect(processFatTools(claudeSh(alias, "git commit -m x"))).toMatchObject({ type: "deny" });
  });

  it("passes a non-git dir and a repo with no commit yet, then denies once it has one", () => {
    const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gate-plain-")));
    const unborn = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gate-unborn-")));
    tmpDirs.push(plain, unborn);
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: unborn });
    for (const dir of [plain, unborn]) {
      expect(processFatTools(claudeWrite(dir, path.join(dir, "src/x.ts"))), dir).toBeNull();
      expect(processFatTools(claudeSh(dir, "git commit -m x")), dir).toBeNull();
      expect(processFatTools(claudeSh(dir, "git push --force")), dir).toBeNull();
    }
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "i"], { cwd: unborn });
    expect(processFatTools(claudeWrite(unborn, path.join(unborn, "src/x.ts")))).toEqual(deny(reasonOf(unborn)));
    expect(processFatTools(claudeSh(unborn, "git commit -m x"))).toMatchObject({ type: "deny" });
  });

  it("denies a git command that commits or destroys work in the main checkout, in every harness's shell", () => {
    const r = committedRepo();
    const commit = `the main checkout is shared: commit inside ${path.join(r, ".worktrees", "<name>")}, then run node ${path.join(r, ".rulesync/scripts/worktree.mjs")} finish <name>`;
    const stash = "git stash in the main checkout can destroy other sessions' work: do it inside your worktree, or run it here only when the user's message asks for git stash";
    expect(processFatTools(claudeSh(r, "git commit -m x"))).toEqual(deny(commit));
    expect(processFatTools(claudeSh(r, "git add -A && git commit -m x", { agent_type: "scout" }))).toEqual(deny(commit));
    expect(processFatTools(claudeSh(r, "rtk git commit -m x"))).toEqual(deny(commit));
    expect(processFatTools(cursorSh(r, "git stash"))).toEqual(deny(stash));
    expect(processHookPayload(cursorSh(r, "git stash"))).toMatchObject({ permission: "deny", agent_message: stash });
    const agy = (command: string, cwd = r) => ({ conversationId: "c1", workspacePaths: [r], toolCall: { name: "run_command", args: { CommandLine: command, Cwd: cwd } } });
    expect(processFatTools(agy("git stash"))).toEqual(deny(stash));
    expect(processFatTools(claudeSh(r, "git -C .worktrees/a stash"))).toBeNull();
    expect(processFatTools(claudeSh(path.join(r, ".worktrees/a"), "git stash && git reset --hard && git commit --amend"))).toBeNull();
    expect(processFatTools(agy("git stash", path.join(r, ".worktrees/a")))).toBeNull();
    expect(processFatTools(claudeSh(r, "git status && git log --oneline"))?.type).not.toBe("deny");
    expect(processFatTools(claudeSh(r, "cat > .tmp/n.md <<'EOF'\ngit stash\ngit commit -m x\nEOF"))?.type).not.toBe("deny");
  });

  it("denies the shared-ref cases from inside a worktree", () => {
    const r = committedRepo();
    const a = path.join(r, ".worktrees/a");
    expect(processFatTools(claudeSh(a, "git push --force"))).toEqual(deny("a force push rewrites shared history: run it only when the user's message asks for a force push"));
    expect(processFatTools(claudeSh(a, "git branch -D wt/other"))).toEqual(deny("wt/other belongs to another worktree: only its own session or the user may delete it"));
    expect(processFatTools(claudeSh(a, "git branch -D main"))).toMatchObject({ type: "deny", reason: expect.stringContaining("main is the shared default branch") });
    expect(processFatTools(claudeSh(a, "git branch -D scratch"))).toBeNull();
  });

  it("lets a subcommand run once the session's git-asked.json holds it, and nothing else", () => {
    const r = committedRepo();
    expect(processFatTools(claudeSh(r, "git stash"))).toMatchObject({ type: "deny" });
    expect(fs.existsSync(askedFile(r))).toBe(false);
    ask(r, JSON.stringify({ words: ["stash"] }));
    for (const send of [(c: string) => claudeSh(r, c), (c: string) => cursorSh(r, c), (c: string) => claudeSh(r, c, { agent_type: "scout" })]) {
      expect(processFatTools(send("git stash")), "stash asked").toBeNull();
      expect(processFatTools(send("git commit -m x")), "commit still denied").toMatchObject({ type: "deny" });
    }
    ask(r, JSON.stringify({ words: ["commit", "force"] }));
    expect(processFatTools(claudeSh(r, "git commit -m x"))).toBeNull();
    expect(processFatTools(claudeSh(r, "git push --force"))).toBeNull();
    expect(processFatTools(claudeSh(r, "git stash"))).toMatchObject({ type: "deny" });
    // another session's grant does not carry over
    expect(processFatTools(claudeSh(r, "git commit -m x", { session_id: "other" }))).toMatchObject({ type: "deny" });
    // a grant never frees a product write
    expect(processFatTools(claudeWrite(r, path.join(r, "src/x.ts")))).toEqual(deny(reasonOf(r)));
    expect(JSON.parse(fs.readFileSync(askedFile(r), "utf8"))).toEqual({ words: ["commit", "force"] });
  });

  it("treats a missing session id, a missing file and a bad file as no grant", () => {
    const r = committedRepo();
    const noSid = { cwd: r, tool_name: "Bash", tool_input: { command: "git stash" } };
    expect(processFatTools(noSid)).toMatchObject({ type: "deny" });
    for (const bad of ["{", "null", "[]", '{"words":"stash"}', '{"words":[1,null]}', ""]) {
      ask(r, bad);
      expect(processFatTools(claudeSh(r, "git stash")), bad).toMatchObject({ type: "deny" });
    }
    fs.rmSync(askedFile(r));
    expect(processFatTools(claudeSh(r, "git stash"))).toMatchObject({ type: "deny" });
  });

  it("sits ahead of the review guard: the main checkout reason wins there, a worktree still hits the review reason", () => {
    const r = committedRepo();
    const file = path.join(r, ".tmp/repo/plans/3-review-plan-20261107T181901Z.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "---\nserial: 3\nname: review-plan\nstatus: in-progress\nreviews: 1\ncreated: 2026-11-07T18:19:01Z\nsource: \"t\"\ncommit: feat: x\nstrategy: review-fast\n---\n\n# review-plan\n\n1.1 [ ] a\n");
    writeStamp(r, SID, file);
    const review = "plan 3 runs strategy review-fast: this session reviews. Spawn implementer-fast for product writes; the plan, the journal and .tmp/ stay writable.";
    expect(processFatTools(claudeWrite(r, path.join(r, "src/x.ts")))).toEqual(deny(reasonOf(r)));
    expect(processFatTools(claudeWrite(r, path.join(r, ".worktrees/a/src/x.ts")))).toEqual(deny(review));
    expect(processFatTools(codexPatch(r, path.join(r, ".worktrees/a/src/x.ts")))).toEqual(deny(review));
    for (const child of ["implementer-fast", "scout"]) {
      expect(processFatTools(claudeWrite(r, path.join(r, ".worktrees/a/src/x.ts"), { agent_type: child })), child).toBeNull();
    }
    expect(processFatTools(claudeWrite(r, path.join(r, ".tmp/repo/n.md")))?.type).not.toBe("deny");
  });

  it("reads win32 spellings of the root", () => {
    const roots = { root: "C:\\r", checkout: "C:\\r", cwd: "C:\\r" };
    const check = (target: string) => mainCheckoutWriteReason(target, roots, path.win32, () => true);
    const reason = "the main checkout is shared: run node C:\\r\\.rulesync\\scripts\\worktree.mjs add <name> and write under C:\\r\\.worktrees\\<name>; only C:\\r\\.tmp\\ is writable here";
    expect(check("C:\\r\\src\\x.ts")).toBe(reason);
    expect(check("c:/R/src/x.ts")).toBe(reason);
    expect(check("src\\x.ts")).toBe(reason);
    expect(check("C:\\r\\.tmp\\repo\\n.md")).toBeNull();
    expect(check("c:/R/.worktrees/a/src/x.ts")).toBeNull();
    expect(check("D:\\other\\x.ts")).toBeNull();
    expect(mainCheckoutWriteReason("C:\\r\\src\\x.ts", roots, path.win32, () => false)).toBeNull();
  });
});

describe("worktree add guard", () => {
  function repo() {
    const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gate-wt-")));
    tmpDirs.push(r);
    spawnSync("git", ["init", "-q"], { cwd: r });
    fs.mkdirSync(path.join(r, "packages/a"), { recursive: true });
    return r;
  }
  const add = "git worktree add ../elsewhere";
  it("denies a worktree outside .worktrees in every harness's shell, scout subagents too", () => {
    const r = repo();
    const a = path.join(r, "packages/a");
    const reason = /^worktrees live in .*[\\/]\.worktrees[\\/]<name> on branch wt\/<name>: run node /;
    const claude = (extra: object = {}) =>
      processHookPayload({ session_id: "w", hook_event_name: "PreToolUse", cwd: r, tool_name: "Bash", tool_input: { command: add }, ...extra });
    expect(claude().hookSpecificOutput.permissionDecisionReason).toMatch(reason);
    expect(claude({ agent_type: "scout" }).hookSpecificOutput.permissionDecisionReason).toMatch(reason);
    const codex = processHookPayload({ session_id: "w", turn_id: "t", model: "m", hook_event_name: "PreToolUse", cwd: r, tool_name: "Bash", tool_input: { command: add } });
    expect(codex.hookSpecificOutput.permissionDecision).toBe("deny");
    const antigravity = processHookPayload({ conversationId: "w", workspacePaths: [r], toolCall: { name: "run_command", args: { CommandLine: add, Cwd: a } } });
    expect(antigravity).toMatchObject({ decision: "deny", reason: expect.stringMatching(reason) });
    const ok = processHookPayload({ session_id: "w", hook_event_name: "PreToolUse", cwd: r, tool_name: "Bash", tool_input: { command: "git worktree add .worktrees/y -b wt/y" } });
    expect(JSON.stringify(ok ?? null)).not.toMatch(/worktrees live in/);
  });

  it("allows a managed worktree add typed from an alias of the repo, in every shape", () => {
    const r = repo();
    const alias = aliasOf(r);
    const add = "git worktree add .worktrees/y -b wt/y";
    const outs = [
      processHookPayload({ session_id: "w", hook_event_name: "PreToolUse", cwd: alias, tool_name: "Bash", tool_input: { command: add } }),
      processHookPayload({ session_id: "w", hook_event_name: "PreToolUse", cwd: alias, tool_name: "Bash", tool_input: { command: add }, agent_type: "scout" }),
      processHookPayload({ conversationId: "w", workspacePaths: [alias], toolCall: { name: "run_command", args: { CommandLine: add, Cwd: alias } } }),
      processHookPayload({ session_id: "w", hook_event_name: "PreToolUse", cwd: r, tool_name: "Bash", tool_input: { command: `git worktree add ${path.join(alias, ".worktrees", "y").split(path.sep).join("/")} -b wt/y` } }),
    ];
    for (const [i, out] of outs.entries()) expect(JSON.stringify(out ?? null), String(i)).not.toMatch(/worktrees live in/);
  });
});

describe("review strategy session stamp", () => {
  const SID = "rv1";
  const KINDS = ["claudeEdit", "claudeWrite", "codexTool", "codexHeredoc", "antigravity", "cursor"] as const;
  type Kind = (typeof KINDS)[number];

  function ws() {
    const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gate-review-")));
    tmpDirs.push(r);
    return r;
  }
  function planText(strategy: string, status: string) {
    return `---\nserial: 3\nname: review-plan\nstatus: ${status}\nreviews: 1\ncreated: 2026-11-07T18:19:01Z\nsource: "t"\ncommit: feat: x\nstrategy: ${strategy}\n---\n\n# review-plan\n\n1.1 [ ] a\n`;
  }
  function planFile(w: string, strategy: string, status = "in-progress") {
    const file = path.join(w, ".tmp/repo/plans/3-review-plan-20261107T181901Z.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = planText(strategy, status);
    fs.writeFileSync(file, text);
    return { file, text };
  }
  /** A write of `target` in the wire shape of each harness. `sid` null leaves the session id out. */
  function write(kind: Kind, w: string, target: string, o: { sid?: string | null; extra?: object; content?: string } = {}) {
    const sid = o.sid === undefined ? SID : o.sid;
    const extra = o.extra ?? {};
    const patch = `*** Begin Patch\n*** Add File: ${target}\n+hi\n*** End Patch`;
    const content = o.content ?? "x";
    switch (kind) {
      case "claudeEdit":
        return { ...(sid && { session_id: sid }), cwd: w, tool_name: "Edit", tool_input: { file_path: target, old_string: "a", new_string: "b" }, ...extra };
      case "claudeWrite":
        return { ...(sid && { session_id: sid }), cwd: w, tool_name: "Write", tool_input: { file_path: target, content }, ...extra };
      case "codexTool":
        return { ...(sid && { session_id: sid }), turn_id: "t1", model: "m", cwd: w, tool_name: "apply_patch", tool_input: { command: patch }, ...extra };
      case "codexHeredoc":
        return { ...(sid && { session_id: sid }), turn_id: "t1", model: "m", cwd: w, tool_name: "Bash", tool_input: { command: `apply_patch <<'EOF'\n${patch}\nEOF\n` }, ...extra };
      case "antigravity":
        return { ...(sid && { conversationId: sid }), workspacePaths: [w], toolCall: { name: "replace_file_content", args: { TargetFile: target, TargetContent: "a", ReplacementContent: "b" } }, ...extra };
      case "cursor":
        return { cursor_version: "2026.11.05", ...(sid && { session_id: sid }), model: "m", cwd: w, tool_name: "Write", tool_input: { file_path: target, content }, ...extra };
    }
  }
  const stamped = (w: string) => fs.existsSync(stampPath(w, SID));
  /** Every stamp under the workspace's sessions, whatever the session id. */
  const stampFiles = (w: string) =>
    fs.existsSync(path.join(w, ".tmp/repo/sessions"))
      ? fs.readdirSync(path.join(w, ".tmp/repo/sessions")).filter((d) => fs.existsSync(path.join(w, ".tmp/repo/sessions", d, "strategy.json")))
      : [];
  /** A stamped session whose plan holds `strategy` at `status`. */
  function active(w: string, strategy = "review-fast", status = "in-progress") {
    const { file } = planFile(w, strategy, status);
    writeStamp(w, SID, file);
    return file;
  }

  for (const kind of KINDS) {
    describe(kind, () => {
      it("stamps the session on a parent save of a review plan, and changes nothing else about the answer", () => {
        for (const strategy of ["review-fast", "review-deep"]) {
          const w = ws();
          const { file, text } = planFile(w, strategy, "ready");
          expect(processFatTools(write(kind, w, file, { content: text })), strategy).toBeNull();
          expect(stamped(w), strategy).toBe(true);
          expect(JSON.parse(fs.readFileSync(stampPath(w, SID), "utf8"))).toEqual({ plan: file });
        }
      });

      it("stamps on a box tick of an in-progress review plan in a session with no stamp (resume)", () => {
        const w = ws();
        const { file, text } = planFile(w, "review-deep");
        expect(stamped(w)).toBe(false);
        processFatTools(write(kind, w, file, { content: text }));
        expect(activeReview(w, SID)).toEqual({ plan: file, serial: 3, strategy: "review-deep" });
      });

      it("writes no stamp for a default plan, without a session id, or from a child", () => {
        const w = ws();
        const dflt = planFile(w, "default");
        processFatTools(write(kind, w, dflt.file, { content: dflt.text }));
        expect(stamped(w)).toBe(false);
        const rev = planFile(w, "review-fast");
        processFatTools(write(kind, w, rev.file, { content: rev.text, sid: null }));
        expect(stampFiles(w)).toEqual([]);
        for (const child of ["scout", "implementer-fast"]) {
          processFatTools(write(kind, w, rev.file, { content: rev.text, extra: { agent_type: child } }));
          expect(stamped(w), child).toBe(false);
        }
      });

      it("writes no stamp for a non-plan write, and the plan's own status decides afterwards", () => {
        const w = ws();
        const { file, text } = planFile(w, "review-fast");
        processFatTools(write(kind, w, path.join(w, "src/x.ts"), { content: text }));
        processFatTools(write(kind, w, path.join(w, ".tmp/repo/roadmaps/r.md"), { content: text }));
        expect(stamped(w)).toBe(false);
        processFatTools(write(kind, w, file, { content: text }));
        expect(activeReview(w, SID)?.strategy).toBe("review-fast");
        for (const status of ["done", "blocked", "ready"]) {
          fs.writeFileSync(file, planText("review-fast", status));
          expect(stamped(w), status).toBe(true);
          expect(activeReview(w, SID), status).toBeNull();
        }
      });
    });
  }

  it("stamps from the Write content, not the file on disk", () => {
    const w = ws();
    const { file } = planFile(w, "default");
    processFatTools(write("claudeWrite", w, file, { content: planText("review-fast", "in-progress") }));
    expect(stamped(w)).toBe(true);
    fs.rmSync(stampPath(w, SID));
    processFatTools(write("claudeWrite", w, file, { content: planText("default", "in-progress") }));
    expect(stamped(w)).toBe(false);
  });

  it("stamps an alias spelling of the plan as the canonical path, once", () => {
    const w = ws();
    const { file, text } = planFile(w, "review-fast");
    const alias = aliasOf(w);
    const spelled = [
      path.join(alias, ".tmp/repo/plans/3-review-plan-20261107T181901Z.md"),
      path.join(w, ".rulesync/../.tmp/repo/plans/3-review-plan-20261107T181901Z.md"),
      path.join(w, "./.tmp/repo/plans/../plans/3-review-plan-20261107T181901Z.md"),
    ];
    for (const target of spelled) {
      processFatTools(write("claudeWrite", target.startsWith(alias) ? alias : w, target, { content: text }));
      expect(JSON.parse(fs.readFileSync(stampPath(w, SID), "utf8")), target).toEqual({ plan: file });
    }
    expect(fs.readdirSync(path.dirname(stampPath(w, SID))).filter((f) => f !== "wrote.txt")).toEqual(["strategy.json"]);
    expect(activeReview(alias, SID)?.plan).toBe(file);
  });

  it("fails open when the stamp cannot be written", () => {
    const w = ws();
    const { file, text } = planFile(w, "review-fast");
    fs.writeFileSync(path.join(w, ".tmp/repo/sessions"), "a file where the directory belongs");
    expect(processFatTools(write("claudeWrite", w, file, { content: text }))).toBeNull();
    expect(processFatTools(write("claudeEdit", w, path.join(w, "src/x.ts")))).toBeNull();
  });

  describe("Grok through orchestrate-parent's emitFat", () => {
    function grok(w: string, tool: string, input: object, extra: object = {}) {
      const out = runHook(
        orchParent,
        { hookEventName: "PreToolUse", toolName: tool, toolInput: input, workspaceRoot: w, session_id: SID, ...extra },
        { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: w, CLAUDE_PROJECT_DIR: "" },
      );
      expect(out.status, out.stderr).toBe(0);
      return out.stdout ? JSON.parse(out.stdout) : null;
    }
    /** The plan Grok's persist hook would save, written the way the host does. */
    function savedPlan(w: string, strategy: string) {
      const body = VALID_PLAN.replace("strategy: default", `strategy: ${strategy}`);
      const saved = grok(w, "Write", { file_path: ".tmp/repo/plans/x.md", content: body, });
      fs.mkdirSync(path.dirname(saved.hookSpecificOutput.updatedInput.file_path), { recursive: true });
      fs.writeFileSync(saved.hookSpecificOutput.updatedInput.file_path, saved.hookSpecificOutput.updatedInput.content);
      return saved.hookSpecificOutput.updatedInput as { file_path: string; content: string };
    }

    it("stamps on a valid Edit and on a full Write of a review plan, and not for default", () => {
      const w = ws();
      const review = savedPlan(w, "review-fast");
      expect(stamped(w)).toBe(false);
      expect(grok(w, "Edit", { file_path: review.file_path, old_string: "1.1 [ ]", new_string: "1.1 [x]" })).toBeNull();
      expect(activeReview(w, SID)).toBeNull();
      expect(JSON.parse(fs.readFileSync(stampPath(w, SID), "utf8"))).toEqual({ plan: review.file_path });
      fs.rmSync(stampPath(w, SID));
      grok(w, "Write", { file_path: review.file_path, content: review.content });
      expect(stamped(w)).toBe(true);

      const other = ws();
      const dflt = savedPlan(other, "default");
      grok(other, "Edit", { file_path: dflt.file_path, old_string: "1.1 [ ]", new_string: "1.1 [x]" });
      grok(other, "Write", { file_path: dflt.file_path, content: dflt.content });
      expect(stamped(other)).toBe(false);
    });

    it("stamps nothing for a child", () => {
      const w = ws();
      const review = savedPlan(w, "review-fast");
      grok(w, "Edit", { file_path: review.file_path, old_string: "1.1 [ ]", new_string: "1.1 [x]" }, { subagent_type: "scout" });
      expect(stamped(w)).toBe(false);
    });
  });

  describe("review deny", () => {
    const reasonFor = (strategy: string) =>
      `plan 3 runs strategy ${strategy}: this session reviews. Spawn ${strategy === "review-fast" ? "implementer-fast" : "implementer-deep"} for product writes; the plan, the journal and .tmp/ stay writable.`;
    const IMPLEMENTER_WRITE = "implementer writes product files and tests only; the reviewer writes the plan and the journal";
    const IMPLEMENTER_GIT = "implementer never stages or commits; report the changed files and the reviewer stages them";

    /** What a parent write is answered when the review is enforced on its harness, else nothing. */
    function parentAnswer(payload: object, strategy = "review-fast") {
      return ENFORCED_HARNESSES.has(harnessOf(payload)) ? { type: "deny", reason: reasonFor(strategy) } : null;
    }

    for (const kind of KINDS) {
      it(`${kind}: denies a parent product write and follows ENFORCED_HARNESSES`, () => {
        for (const strategy of ["review-fast", "review-deep"]) {
          const w = ws();
          active(w, strategy);
          const payload = write(kind, w, path.join(w, "src/x.ts"));
          expect(processFatTools(payload), strategy).toEqual(parentAnswer(payload, strategy));
          const nested = write(kind, w, path.join(w, "packages/a/.tmp/x.md"));
          expect(processFatTools(nested), strategy).toEqual(parentAnswer(nested, strategy));
        }
      });

      it(`${kind}: allows the plan, the journal, .tmp and scratch, judged after the rewrite`, () => {
        const w = ws();
        const plan = active(w);
        for (const target of [plan, path.join(w, ".tmp/repo/implementations/i.md"), path.join(w, ".tmp/x"), "tmp/notes.md", "./.tmp/repo/plans/p.md", `${w}/src/../.tmp/repo/plans/p.md`]) {
          expect(processFatTools(write(kind, w, target))?.type, target).not.toBe("deny");
        }
      });

      it(`${kind}: holds the deny for a spelling of a product path, and allows a child`, () => {
        const w = ws();
        active(w);
        const dotted = write(kind, w, `${w}/.rulesync/../src/x.ts`);
        expect(processFatTools(dotted)).toEqual(parentAnswer(dotted));
        const relative = write(kind, w, "src/x.ts");
        expect(processFatTools(relative)).toEqual(parentAnswer(relative));
        for (const child of ["implementer-fast", "implementer-deep", "scout"]) {
          expect(processFatTools(write(kind, w, path.join(w, "src/x.ts"), { extra: { agent_type: child } })), child).toBeNull();
        }
      });

      it(`${kind}: allows after the plan is done or blocked, with no session id, or with a default plan`, () => {
        const w = ws();
        const plan = active(w);
        expect(processFatTools(write(kind, w, path.join(w, "src/x.ts"), { sid: null }))).toBeNull();
        expect(processFatTools(write(kind, w, path.join(w, "src/x.ts"), { sid: "other" }))).toBeNull();
        for (const [strategy, status] of [["review-fast", "done"], ["review-fast", "blocked"], ["default", "in-progress"]]) {
          fs.writeFileSync(plan, planText(strategy, status));
          expect(processFatTools(write(kind, w, path.join(w, "src/x.ts"))), `${strategy} ${status}`).toBeNull();
        }
      });

      it(`${kind}: denies an implementer's write to the plan or the journal under every strategy, and nothing else`, () => {
        for (const state of ["none", "default", "review-fast", "review-deep"]) {
          const w = ws();
          if (state !== "none") active(w, state);
          for (const target of [path.join(w, ".tmp/repo/plans/p.md"), path.join(w, ".tmp/repo/implementations/i.md"), "tmp/plans/p.md"]) {
            const out = processFatTools(write(kind, w, target, { extra: { agent_type: "implementer-fast" } }));
            expect(out, `${state} ${target}`).toEqual({ type: "deny", reason: IMPLEMENTER_WRITE });
          }
          for (const target of [path.join(w, "src/x.ts"), path.join(w, ".tmp/x"), path.join(w, ".tmp/repo/scratch/s.md"), path.join(w, ".tmp/repo/handoffs/h.md")]) {
            const out = processFatTools(write(kind, w, target, { extra: { agent_type: "implementer-deep" } }));
            expect(out?.type, `${state} ${target}`).not.toBe("deny");
          }
          const scout = processFatTools(write(kind, w, path.join(w, ".tmp/repo/plans/p.md"), { extra: { agent_type: "scout" } }));
          expect(scout?.type).not.toBe("deny");
        }
      });
    }

    it("a parent shell write is not parsed", () => {
      const w = ws();
      active(w);
      const sh = { session_id: SID, cwd: w, tool_name: "Bash", tool_input: { command: "echo hi > src/x.ts" } };
      expect(processFatTools(sh)).toBeNull();
    });

    it("a Cursor parent write is allowed because Cursor is not enforced", () => {
      const w = ws();
      active(w);
      expect(ENFORCED_HARNESSES.has("cursor")).toBe(false);
      expect(processFatTools(write("cursor", w, path.join(w, "src/x.ts")))).toBeNull();
    });

    it("a Cursor parent write in a committed repo is denied by the main-checkout guard whatever ENFORCED_HARNESSES says", () => {
      const w = committedRepo("gate-review-");
      active(w);
      expect(ENFORCED_HARNESSES.has("cursor")).toBe(false);
      const out = processFatTools(write("cursor", w, path.join(w, "src/x.ts")));
      expect(out).toMatchObject({ type: "deny", reason: expect.stringMatching(/^the main checkout is shared: run node /) });
      expect(processFatTools(write("cursor", w, path.join(w, ".worktrees/a/src/x.ts")))).toBeNull();
    });

    it("a reviewer parent's product write inside a worktree still gets the review reason", () => {
      const w = committedRepo("gate-review-");
      active(w);
      for (const kind of ["claudeWrite", "claudeEdit", "codexTool", "codexHeredoc"] as const) {
        const out = processFatTools(write(kind, w, path.join(w, ".worktrees/a/src/x.ts")));
        expect(out, kind).toEqual({ type: "deny", reason: reasonFor("review-fast") });
      }
    });

    // Live payloads from `claude -p`, `codex exec`, `grok -p`, `agy -p` and `cursor-agent -p` (phase 6 probe, 2026-11-07),
    // trimmed to the keys that matter. Each case is a parent write and the write of a spawned `scout`.
    describe("captured parent and child payloads", () => {
      const tool = (file: string) => ({ file_path: file, content: "x\n" });
      const patch = (file: string) => `*** Begin Patch\n*** Add File: ${file}\n+x\n*** End Patch`;
      const cases = {
        claude: {
          parent: (f: string) => ({ session_id: "6300f867", hook_event_name: "PreToolUse", tool_name: "Write", tool_input: tool(f) }),
          child: (f: string) => ({ session_id: "6300f867", agent_id: "a6992087d63505a23", agent_type: "scout", hook_event_name: "PreToolUse", tool_name: "Write", tool_input: tool(f) }),
          sid: ["6300f867", "6300f867"],
        },
        codex: {
          parent: (f: string) => ({ session_id: "01a1b75e-14b3", turn_id: "01a1b75e-164b", hook_event_name: "PreToolUse", model: "gpt-6-luna", tool_name: "apply_patch", tool_input: { command: patch(f) } }),
          child: (f: string) => ({ session_id: "01a1b75e-14b3", turn_id: "01a1b75e-29af", agent_id: "01a1b75e-29a2", agent_type: "scout", hook_event_name: "PreToolUse", model: "gpt-6-luna", tool_name: "apply_patch", tool_input: { command: patch(f) } }),
          sid: ["01a1b75e-14b3", "01a1b75e-14b3"],
        },
        // Grok's wire shape is Claude's: harnessOf says claude, so "claude" in ENFORCED_HARNESSES enforces Grok too.
        grok: {
          parent: (f: string) => ({ hookEventName: "pre_tool_use", sessionId: "01a1b75e-d19d", toolName: "write", toolInput: tool(f), hook_event_name: "PreToolUse", session_id: "01a1b75e-d19d", tool_name: "write", tool_input: tool(f) }),
          child: (f: string) => ({ hookEventName: "pre_tool_use", sessionId: "01a1b75f-2238", toolName: "write", toolInput: tool(f), subagentType: "scout", hook_event_name: "PreToolUse", session_id: "01a1b75f-2238", tool_name: "write", tool_input: tool(f) }),
          sid: ["01a1b75e-d19d", "01a1b75f-2238"],
        },
      };
      for (const [name, c] of Object.entries(cases)) {
        it(`${name}: the child carries a marker the gate reads, so the parent is denied and the child is not`, () => {
          const w = ws();
          const [parentSid] = c.sid;
          const { file } = planFile(w, "review-fast");
          writeStamp(w, parentSid, file);
          const parent = c.parent(path.join(w, "src/x.ts"));
          const child = c.child(path.join(w, "src/x.ts"));
          expect(harnessOf(parent)).toBe(name === "codex" ? "codex" : "claude");
          expect(harnessOf(child)).toBe(harnessOf(parent));
          expect(ENFORCED_HARNESSES.has(harnessOf(parent))).toBe(true);
          expect(sessionIdOf(parent)).toBe(c.sid[0]);
          expect(sessionIdOf(child)).toBe(c.sid[1]);
          expect([isParentOrchestrator(parent), subagentTypeOf(parent)]).toEqual([true, ""]);
          expect([isParentOrchestrator(child), subagentTypeOf(child)]).toEqual([false, "scout"]);
          expect(processFatTools({ ...parent, cwd: w })).toEqual({ type: "deny", reason: reasonFor("review-fast") });
          expect(processFatTools({ ...child, cwd: w })).toBeNull();
        });
      }

      it("Antigravity sends its session id only as conversationId, and its child carries no marker", () => {
        const parent = { conversationId: "d1398f48", modelName: "gemini-3.8-flash-high", stepIdx: 2, toolCall: { name: "write_file", args: { Path: "/w/parent.txt", Content: "parent\n" } } };
        const child = { conversationId: "4ea12b55", modelName: "gemini-3.8-flash-tiered", stepIdx: 2, toolCall: { name: "run_command", args: { CommandLine: "printf 'child\\n' > /w/child.txt" } } };
        expect([harnessOf(parent), harnessOf(child)]).toEqual(["antigravity", "antigravity"]);
        expect([sessionIdOf(parent), sessionIdOf(child)]).toEqual(["d1398f48", "4ea12b55"]);
        expect([isParentOrchestrator(parent), isParentOrchestrator(child)]).toEqual([true, true]);
        expect([subagentTypeOf(parent), subagentTypeOf(child)]).toEqual(["", ""]);
        expect(ENFORCED_HARNESSES.has("antigravity")).toBe(false);
        // A review is running for the parent's conversation; an unenforced harness is still let through.
        const w = ws();
        writeStamp(w, "d1398f48", planFile(w, "review-fast").file);
        const product = path.join(w, "src/x.ts");
        expect(processFatTools({ ...parent, workspacePaths: [w], toolCall: { name: "write_file", args: { Path: product, Content: "x" } } })).toBeNull();
        expect(processFatTools(write("antigravity", w, product, { sid: "d1398f48" }))).toBeNull();
      });

      it("Antigravity's edit in a committed repo is denied by the main-checkout guard though it is not enforced", () => {
        const w = committedRepo("gate-review-");
        writeStamp(w, "d1398f48", planFile(w, "review-fast").file);
        const out = processFatTools(write("antigravity", w, path.join(w, "src/x.ts"), { sid: "d1398f48" }));
        expect(out).toMatchObject({ type: "deny", reason: expect.stringMatching(/^the main checkout is shared: run node /) });
        expect(processFatTools(write("antigravity", w, path.join(w, ".worktrees/a/src/x.ts"), { sid: "d1398f48" }))).toBeNull();
      });

      it("Cursor's child has its own session id and no marker", () => {
        const parent = { conversation_id: "4fc450b7", session_id: "4fc450b7", model: "default", tool_name: "Write", tool_input: tool("/w/parent.txt"), hook_event_name: "preToolUse", cursor_version: "2026.11.05-86047df" };
        const child = { ...parent, conversation_id: "26bb97fb", session_id: "26bb97fb", tool_input: tool("/w/child.txt") };
        expect([harnessOf(parent), harnessOf(child)]).toEqual(["cursor", "cursor"]);
        expect([isParentOrchestrator(parent), isParentOrchestrator(child)]).toEqual([true, true]);
        expect(ENFORCED_HARNESSES.has("cursor")).toBe(false);
      });
    });

    it("judges by the canonical path through an alias of the root, and for a path.win32 root", () => {
      const w = ws();
      const plan = active(w);
      const alias = aliasOf(w);
      for (const kind of ["claudeWrite", "codexTool", "codexHeredoc"] as const) {
        const product = write(kind, alias, path.join(alias, "src/x.ts"));
        expect(processFatTools(product), kind).toEqual(parentAnswer(product));
        for (const target of [path.join(alias, ".tmp/repo/plans/p.md"), path.join(alias, ".tmp/x")]) {
          expect(processFatTools(write(kind, alias, target))?.type, `${kind} ${target}`).not.toBe("deny");
        }
      }
      expect(activeReview(alias, SID)?.plan).toBe(plan);
      const root = "C:\\r";
      expect(isOutsideRootTmp("C:\\r\\src\\x.ts", root, path.win32)).toBe(true);
      expect(isOutsideRootTmp("C:\\r\\.tmpx\\x", root, path.win32)).toBe(true);
      expect(isOutsideRootTmp("D:\\r\\.tmp\\x", root, path.win32)).toBe(true);
      expect(isOutsideRootTmp("c:\\R\\.TMP\\repo\\plans\\p.md", root, path.win32)).toBe(false);
      expect(isOutsideRootTmp("C:\\r\\.tmp\\x", root, path.win32)).toBe(false);
    });

    it("an implementer's git add and git commit are denied under every strategy; reads and a parent's git pass", () => {
      for (const state of ["none", "default", "review-fast"]) {
        const w = ws();
        if (state !== "none") active(w, state);
        const sh = (command: string, extra: object = {}) =>
          processFatTools({ session_id: SID, cwd: w, tool_name: "Bash", tool_input: { command }, agent_type: "implementer-fast", ...extra });
        for (const command of ["git add src/x.ts", "git add -A", "git commit -m x", "git -C . commit -m x", "cd src && git add x.ts", "git add . && git status", "git --no-pager commit -m x"]) {
          expect(sh(command), `${state} ${command}`).toEqual({ type: "deny", reason: IMPLEMENTER_GIT });
        }
        for (const command of ["git status", "git diff", "git log -1", "git diff --stat"]) {
          expect(sh(command)?.type, command).not.toBe("deny");
        }
        expect(sh("git add x", { agent_type: "scout" })).toBeNull();
        expect(sh("git commit -m x", { agent_type: undefined })).toBeNull();
        const codex = processFatTools({ session_id: SID, turn_id: "t", model: "m", cwd: w, tool_name: "Bash", tool_input: { command: "git commit -m x" }, agent_type: "implementer-deep" });
        expect(codex).toEqual({ type: "deny", reason: IMPLEMENTER_GIT });
      }
    });

    it("isImplementer names the implementer-* children only", () => {
      expect(["implementer-fast", "implementer-deep", "implementer-x"].map(isImplementer)).toEqual([true, true, true]);
      expect(["", "scout", "implementer", "orchestrator", "my-implementer-fast"].map(isImplementer)).toEqual([false, false, false, false, false]);
    });

    it("Grok: a parent write through orchestrate-parent follows ENFORCED_HARNESSES", () => {
      const w = ws();
      active(w);
      const run = (extra: object, file = path.join(w, "src/x.ts")) => {
        const out = runHook(
          orchParent,
          { hookEventName: "PreToolUse", toolName: "Write", toolInput: { file_path: file, content: "x" }, workspaceRoot: w, session_id: SID, ...extra },
          { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: w, CLAUDE_PROJECT_DIR: "" },
        );
        expect(out.status, out.stderr).toBe(0);
        return out.stdout ? JSON.parse(out.stdout) : null;
      };
      const payload = { hookEventName: "PreToolUse", toolName: "Write", toolInput: {}, workspaceRoot: w, session_id: SID };
      const parent = run({});
      if (ENFORCED_HARNESSES.has(harnessOf(payload))) expect(parent).toMatchObject({ decision: "block", reason: reasonFor("review-fast") });
      else expect(parent).toBeNull();
      expect(run({ subagent_type: "implementer-fast" })).toBeNull();
      expect(run({ subagent_type: "scout" })).toBeNull();
      expect(run({}, path.join(w, ".tmp/x.md"))?.decision).toBeUndefined();
    });
  });

  describe("implementer and reviewer test runs", () => {
    const job = (w: string, cmd: string) => jobCommand(w, `--job test --query ${quoteQuery(cmd)}`);
    const claudeSh = (w: string, command: string, extra: object = {}) => ({ session_id: SID, cwd: w, tool_name: "Bash", tool_input: { command }, ...extra });
    const codexSh = (w: string, command: string, extra: object = {}) => ({ session_id: SID, turn_id: "t1", model: "m", cwd: w, tool_name: "Bash", tool_input: { command }, ...extra });
    const rewrite = (w: string, command: string) => ({ type: "rewrite", updatedInput: { command: job(w, command) } });

    it("rewrites an implementer child's test run to the job test and passes a compound through", () => {
      const w = ws();
      for (const agent of ["implementer-fast", "implementer-deep"]) {
        const extra = { agent_type: agent };
        expect(processFatTools(claudeSh(w, "bun run test x.test.ts", extra)), agent).toEqual(rewrite(w, "bun run test x.test.ts"));
        expect(processHookPayload(codexSh(w, "bun run test x.test.ts", extra)), agent).toEqual({
          hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { command: job(w, "bun run test x.test.ts") } },
        });
        expect(processFatTools(claudeSh(w, "bun run test && echo ok", extra)), agent).toBeNull();
        expect(processFatTools(claudeSh(w, "bun run test x | tail -5", extra)), agent).toBeNull();
      }
      for (const cmd of ["bun test", "bunx vitest run a.test.ts", "bun vitest", "npx vitest run", "vitest", "npm test", "npm run test -- a", "pnpm test", "pnpm run test", "  bun run test  "]) {
        const out = processFatTools(claudeSh(w, cmd, { agent_type: "implementer-fast" }));
        expect(out, cmd).toEqual(rewrite(w, cmd.trim()));
      }
    });

    it("leaves other implementer commands to the existing rewrites", () => {
      const w = ws();
      const extra = { agent_type: "implementer-fast" };
      expect(processFatTools(claudeSh(w, "bun run typecheck", extra))).toBeNull();
      expect(processFatTools(claudeSh(w, "echo bun run test", extra))).toBeNull();
      expect(processFatTools(claudeSh(w, "ls src", extra))).toEqual({ type: "rewrite", updatedInput: { command: "rtk ls src" } });
      const dump = processFatTools(claudeSh(w, "cat a.txt", extra));
      expect(dump).toMatchObject({ type: "rewrite" });
      expect((dump as any).updatedInput.command).toMatch(/job\.mjs --job exec --query /);
      const job1 = job(w, "bun run test x");
      expect(processFatTools(claudeSh(w, job1, extra))).toBeNull();
    });

    it("rewrites a parent's test run only while a review plan is in progress in its session", () => {
      const w = ws();
      const cmd = "bun run test x.test.ts";
      expect(processFatTools(claudeSh(w, cmd))).toBeNull();
      const plan = active(w);
      expect(processFatTools(claudeSh(w, cmd))).toEqual(rewrite(w, cmd));
      expect(processFatTools(claudeSh(w, "bun run test && echo ok"))).toBeNull();
      expect(processFatTools(claudeSh(w, cmd, { session_id: "other" }))).toBeNull();
      expect(processFatTools(claudeSh(w, cmd, { session_id: undefined }))).toBeNull();
      for (const [strategy, status] of [["default", "in-progress"], ["review-fast", "ready"], ["review-fast", "done"], ["review-fast", "blocked"]]) {
        fs.writeFileSync(plan, planText(strategy, status));
        expect(processFatTools(claudeSh(w, cmd)), `${strategy} ${status}`).toBeNull();
      }
    });

    it("leaves a scout child's command and a stampless default session unchanged", () => {
      const w = ws();
      active(w);
      expect(processFatTools(claudeSh(w, "bun run test x", { agent_type: "scout" }))).toBeNull();
      const other = ws();
      const { file } = planFile(other, "default");
      writeStamp(other, SID, file);
      expect(processFatTools(claudeSh(other, "bun run test x"))).toBeNull();
    });
  });

  describe("without a running review the gate answers as it did before", () => {
    /** Parent and scout calls of every kind the gate handles, answered in one workspace. */
    function bundle(w: string) {
      fs.mkdirSync(path.join(w, "src"), { recursive: true });
      fs.writeFileSync(path.join(w, "src/a.ts"), "x\n");
      const calls: object[] = [];
      for (const kind of KINDS) {
        for (const target of [path.join(w, "src/x.ts"), path.join(w, ".tmp/repo/plans/p.md"), "tmp/notes.md", path.join(w, "packages/a/.tmp/repo/scratch/s.md")]) {
          calls.push(write(kind, w, target));
          calls.push(write(kind, w, target, { extra: { agent_type: "scout" } }));
        }
      }
      for (const command of ["bun run test x.test.ts", "bun run test && echo ok", "cat a.txt", "ls src", "git add x", "git commit -m x"]) {
        calls.push({ session_id: SID, cwd: w, tool_name: "Bash", tool_input: { command } });
        calls.push({ session_id: SID, cwd: w, tool_name: "Bash", tool_input: { command }, agent_type: "scout" });
      }
      calls.push({ session_id: SID, cwd: w, tool_name: "Grep", tool_input: { pattern: "x" } });
      calls.push({ session_id: SID, cwd: w, tool_name: "Read", tool_input: { file_path: path.join(w, "src/a.ts") } });
      return calls.map((c) => JSON.stringify(processFatTools(c)).split(w).join("<ws>"));
    }

    it("is unchanged by no stamp, no session id, or a stamp whose plan is default, ready, done or blocked", () => {
      const base = bundle(ws());
      expect(base.filter((r) => r.includes('"deny"'))).toEqual([]);
      expect(base.filter((r) => r === "null").length).toBeGreaterThan(30);
      const states: Array<[string, (w: string) => void]> = [
        ["default", (w) => active(w, "default")],
        ["ready", (w) => active(w, "review-fast", "ready")],
        ["done", (w) => active(w, "review-deep", "done")],
        ["blocked", (w) => active(w, "review-fast", "blocked")],
        ["stamp of a missing plan", (w) => writeStamp(w, SID, path.join(w, ".tmp/repo/plans/gone.md"))],
        ["corrupt stamp", (w) => {
          fs.mkdirSync(path.dirname(stampPath(w, SID)), { recursive: true });
          fs.writeFileSync(stampPath(w, SID), "{");
        }],
        ["stamp for another session", (w) => {
          const { file } = planFile(w, "review-fast");
          writeStamp(w, "other", file);
        }],
      ];
      for (const [name, arm] of states) {
        const w = ws();
        arm(w);
        expect(bundle(w), name).toEqual(base);
      }
    });
  });
});
