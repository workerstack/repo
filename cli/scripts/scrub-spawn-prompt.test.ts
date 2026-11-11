import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runHook, spawnHook } from "./fixtures/run-hook.ts";
import { main as orchMain } from "./orchestrate-parent.ts";
import {
  MAX_PROMPT_CHARS,
  TRUNCATE_SUFFIX,
  capSpawnPrompt,
  main,
  processHookPayload,
  rewriteSpawnToolInput,
} from "./scrub-spawn-prompt.ts";
import { scrubText } from "./scrub-text-lib.ts";
import { resolveRoots } from "./workspace-root.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
// Plans live in the main checkout's .tmp even when this suite runs in a worktree.
const plansRoot = resolveRoots({ workspaceRoot: root }).root;

type HookOut = {
  decision?: string;
  reason?: string;
  hookSpecificOutput?: { hookEventName?: string; updatedInput?: unknown };
};

function parseOut(stdout: string): HookOut {
  const v: unknown = JSON.parse(stdout);
  if (v === null || typeof v !== "object") throw new Error(`hook printed non-object JSON: ${stdout}`);
  return v;
}

const fillerPrompt = "please can you make me a counter app, thanks";
const scrubbedPrompt = scrubText(fillerPrompt);

describe("rewriteSpawnToolInput", () => {
  it("scrubs prompt with intent and preserves other fields", () => {
    const updated = rewriteSpawnToolInput({
      description: "build it",
      name: "feat",
      prompt: fillerPrompt,
      subagent_type: "scout",
    });
    expect(updated).toStrictEqual({
      description: "build it",
      name: "feat",
      prompt: scrubbedPrompt,
      subagent_type: "scout",
    });
    expect(updated?.prompt).not.toBe(fillerPrompt);
  });

  it("returns null when prompt is already scrubbed", () => {
    expect(
      rewriteSpawnToolInput({
        prompt: scrubbedPrompt,
        subagent_type: "thinker",
      }),
    ).toBeNull();
  });

  it("leaves type alone when prompt is already scrubbed", () => {
    expect(
      rewriteSpawnToolInput({
        prompt: "ship it",
        subagent_type: "Explore",
      }),
    ).toBeNull();
    expect(rewriteSpawnToolInput({ prompt: "ship it" })).toBeNull();
  });

  it("scrubs prompt and keeps Explore, Plan, and a missing type", () => {
    expect(
      rewriteSpawnToolInput({
        prompt: fillerPrompt,
        subagent_type: "Explore",
      }),
    ).toStrictEqual({ prompt: scrubbedPrompt, subagent_type: "Explore" });
    expect(
      rewriteSpawnToolInput({
        prompt: fillerPrompt,
        type: "Plan",
      }),
    ).toStrictEqual({ prompt: scrubbedPrompt, type: "Plan" });
    expect(rewriteSpawnToolInput({ prompt: fillerPrompt })).toStrictEqual({
      prompt: scrubbedPrompt,
    });
  });
});

describe("repo hook scrub-spawn-prompt (spawned)", () => {
  it("scrubs a spawn prompt through the real entry", () => {
    const result = spawnHook("scrub-spawn-prompt", {
      hookEventName: "PreToolUse",
      toolInput: { description: "feat work", prompt: fillerPrompt },
      toolName: "spawn_subagent",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(parseOut(result.stdout).hookSpecificOutput?.updatedInput).toStrictEqual({
      description: "feat work",
      prompt: scrubbedPrompt,
    });
  });
});

describe("scrub-spawn-prompt adapter (stdin)", () => {
  it("rewrites prompt and preserves other fields", () => {
    const result = runHook(main, {
      hookEventName: "PreToolUse",
      toolInput: {
        description: "feat work",
        prompt: fillerPrompt,
        resume_from: "abc",
        subagent_type: "scout",
      },
      toolName: "spawn_subagent",
    });
    expect(result.status).toBe(0);
    const out = parseOut(result.stdout);
    expect(out).toStrictEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          description: "feat work",
          prompt: scrubbedPrompt,
          resume_from: "abc",
          subagent_type: "scout",
        },
      },
    });
  });

  it("accepts Claude snake_case tool_input", () => {
    const result = runHook(main, {
      hook_event_name: "PreToolUse",
      tool_input: {
        description: "keep me",
        prompt: fillerPrompt,
        subagent_type: "thinker",
      },
      tool_name: "Task",
    });
    expect(result.status).toBe(0);
    expect(parseOut(result.stdout).hookSpecificOutput!.updatedInput).toStrictEqual({
      description: "keep me",
      prompt: scrubbedPrompt,
      subagent_type: "thinker",
    });
  });

  it("fail-opens (empty stdout, 0) when prompt is unchanged", () => {
    const result = runHook(main, {
      toolInput: { prompt: scrubbedPrompt, subagent_type: "scout" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("fail-opens on invalid JSON", () => {
    const result = runHook(main, "{not json");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("fail-opens when prompt is missing", () => {
    const result = runHook(main, {
      toolInput: { description: "no prompt", subagent_type: "scout" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});

describe("orchestrate-parent spawn rewrite", () => {
  it("scrubs prompt and does not inject a type", () => {
    const result = runHook(
      orchMain,
      {
        hookEventName: "PreToolUse",
        toolInput: {
          description: "feat",
          name: "child",
          prompt: fillerPrompt,
        },
        toolName: "spawn_subagent",
      },
      { GROK_HOOK_EVENT: "pre_tool_use" },
    );
    expect(result.status).toBe(0);
    const out = parseOut(result.stdout);
    expect(out.hookSpecificOutput!.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput!.updatedInput).toStrictEqual({
      description: "feat",
      name: "child",
      prompt: scrubbedPrompt,
    });
    expect(out.decision).toBeUndefined();
  });

  it("keeps Explore and other host types", () => {
    const result = runHook(
      orchMain,
      {
        hookEventName: "PreToolUse",
        toolInput: {
          prompt: fillerPrompt,
          subagent_type: "Explore",
        },
        toolName: "Task",
      },
      { GROK_HOOK_EVENT: "pre_tool_use" },
    );
    expect(result.status).toBe(0);
    expect(parseOut(result.stdout).hookSpecificOutput!.updatedInput).toStrictEqual({
      prompt: scrubbedPrompt,
      subagent_type: "Explore",
    });
  });
});

describe("capSpawnPrompt transcript + truncate", () => {
  it("strips pasted transcripts and keeps first You are + facts + abs paths", () => {
    const raw = fs.readFileSync(path.join(here, "fixtures/spawn-transcript.txt"), "utf8");
    const out = capSpawnPrompt(raw);
    expect(out).toMatch(/^You are scout subagent\./);
    expect(out).not.toMatch(/^Human:/m);
    expect(out).not.toMatch(/^Assistant:/m);
    expect(out).not.toMatch(/^\[orchestrator\]:/m);
    expect(out).not.toMatch(/^\[scout\]:/m);
    expect(out.match(/You are scout subagent/g)).toHaveLength(1);
    expect(out).not.toContain("nested paste");
    expect(out).toContain("1 match.");
    expect(out).toContain("- scripts/gate-fat-tools.ts:1 — exists");
    expect(out).not.toContain("verdict: ok");
    expect(out).toContain("/home/ecomet/Development/repo-test-2/scripts/gate-fat-tools.ts");
  });

  it("denies over-cap prompts after scrub without slicing or …[truncated]", () => {
    const template = fs.readFileSync(path.join(here, "fixtures/spawn-overcap.txt"), "utf8");
    const raw = template.replace("XXXX_PAD", "x".repeat(MAX_PROMPT_CHARS + 1));
    const out = capSpawnPrompt(raw);
    expect(out.length).toBeGreaterThan(MAX_PROMPT_CHARS);
    expect(out).not.toContain(TRUNCATE_SUFFIX);
    expect(out).toContain("1 match.");
    expect(out).toContain("- /home/ecomet/Development/repo-test-2/README.md:1 — keep me");
    expect(out).not.toContain("verdict: ok");
    expect(out).toContain("/home/ecomet/Development/repo-test-2/README.md");
    const rewritten = rewriteSpawnToolInput({
      prompt: raw,
      subagent_type: "scout",
    });
    if (rewritten && typeof rewritten.prompt === "string") {
      expect(rewritten.prompt).not.toContain(TRUNCATE_SUFFIX);
      expect(rewritten.prompt.length).toBeGreaterThan(MAX_PROMPT_CHARS);
    }
    const ws = root;
    const denied = processHookPayload({
      toolInput: { prompt: raw, subagent_type: "scout" },
      workspaceRoot: ws,
    });
    expect(denied).toMatchObject({ decision: "block" });
    expect(denied!.reason).toContain(`${plansRoot}/.tmp/repo/plans/`);
    expect(denied!.reason).toMatch(/re-spawn/i);
    expect(denied!.reason).toMatch(/abs path/i);
    expect(JSON.stringify(denied)).not.toContain(TRUNCATE_SUFFIX);
    expect(denied!.hookSpecificOutput?.updatedInput).toBeUndefined();
  });

  it("allows prompts at the cap after scrub", () => {
    expect(MAX_PROMPT_CHARS).toBe(100000);
    const raw = "x".repeat(MAX_PROMPT_CHARS);
    const out = capSpawnPrompt(raw);
    expect(out.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    expect(out).not.toContain(TRUNCATE_SUFFIX);
    const payload = processHookPayload({
      toolInput: { prompt: raw, subagent_type: "scout" },
      workspaceRoot: root,
    });
    if (payload && payload.decision) expect(payload.decision).not.toBe("block");
  });
});

describe("processHookPayload", () => {
  it("prefers toolInput over tool_input", () => {
    expect(
      processHookPayload({
        toolInput: { prompt: fillerPrompt, tag: "camel" },
        tool_input: { prompt: fillerPrompt, tag: "snake" },
      }),
    ).toMatchObject({ hookSpecificOutput: { updatedInput: { prompt: scrubbedPrompt, tag: "camel" } } });
  });

  it("answers a Codex spawn rewrite with allow and a Claude one without", () => {
    const codex = processHookPayload({
      model: "m",
      tool_input: { prompt: fillerPrompt },
      tool_name: "spawn_agent",
      turn_id: "t1",
    });
    expect(codex).toStrictEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { prompt: scrubbedPrompt },
      },
    });
    const claude = processHookPayload({ tool_input: { prompt: fillerPrompt }, tool_name: "Agent" });
    expect(
      processHookPayload({ tool_input: { prompt: fillerPrompt }, tool_name: "Agent", turn_id: "t1" }),
    ).toStrictEqual(claude);
    expect(claude).toStrictEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { prompt: scrubbedPrompt } },
    });
  });
});

describe("orchestrate-parent spawn cap deny", () => {
  it("denies Grok spawn over cap without updatedInput slice", () => {
    const prompt = "x".repeat(MAX_PROMPT_CHARS + 1);
    const result = runHook(
      orchMain,
      {
        hookEventName: "PreToolUse",
        toolInput: { prompt, subagent_type: "scout" },
        toolName: "spawn_subagent",
        workspaceRoot: root,
      },
      { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: root },
    );
    expect(result.status).toBe(0);
    const json = parseOut(result.stdout);
    expect(json.decision).toBe("block");
    expect(json.reason).toContain(`${plansRoot}/.tmp/repo/plans/`);
    expect(json.reason).toMatch(/re-spawn/i);
    expect(result.stdout).not.toContain(TRUNCATE_SUFFIX);
    expect(json.hookSpecificOutput?.updatedInput).toBeUndefined();
  });

  it("allows Grok spawn under cap", () => {
    const result = runHook(
      orchMain,
      {
        hookEventName: "PreToolUse",
        toolInput: {
          prompt: "You are scout subagent. ship it",
          subagent_type: "scout",
        },
        toolName: "spawn_subagent",
        workspaceRoot: root,
      },
      { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: root },
    );
    expect(result.status).toBe(0);
    if (result.stdout) {
      const json = parseOut(result.stdout);
      expect(json.decision).not.toBe("block");
    }
  });
});
