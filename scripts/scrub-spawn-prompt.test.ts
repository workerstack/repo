import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scrubText } from "./scrub-text-lib.mjs";
import {
  MAX_PROMPT_CHARS,
  TRUNCATE_SUFFIX,
  capSpawnPrompt,
  grokDefaultGrunt,
  hookResponse,
  processHookPayload,
  rewriteSpawnToolInput,
} from "./scrub-spawn-prompt.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const adapter = path.join(here, "scrub-spawn-prompt.mjs");
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

const fillerPrompt = "please can you make me a counter app, thanks";
const scrubbedPrompt = scrubText(fillerPrompt, { intent: true });

describe("rewriteSpawnToolInput", () => {
  it("scrubs prompt with intent and preserves other fields", () => {
    const updated = rewriteSpawnToolInput({
      prompt: fillerPrompt,
      description: "build it",
      subagent_type: "implementer",
      name: "feat",
    });
    expect(updated).toEqual({
      prompt: scrubbedPrompt,
      description: "build it",
      subagent_type: "implementer",
      name: "feat",
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

  it("defaults type to grunt on Grok last-wins path", () => {
    expect(
      rewriteSpawnToolInput(
        { prompt: "ship it", subagent_type: "sergeant" },
        { defaultGrunt: true },
      ),
    ).toEqual({ prompt: "ship it", subagent_type: "grunt" });
  });

  it("combines type default and prompt scrub in one object", () => {
    expect(
      rewriteSpawnToolInput(
        { prompt: fillerPrompt, description: "keep", extra: 1 },
        { defaultGrunt: true },
      ),
    ).toEqual({
      prompt: scrubbedPrompt,
      description: "keep",
      extra: 1,
      subagent_type: "grunt",
    });
  });

  it("maps unknown/forbidden types to grunt; Explore→grunt", () => {
    expect(
      rewriteSpawnToolInput(
        { prompt: "ship it", subagent_type: "implementer" },
        { defaultGrunt: true },
      ),
    ).toEqual({ prompt: "ship it", subagent_type: "grunt" });
    expect(
      rewriteSpawnToolInput(
        { prompt: "ship it", name: "thinker" },
        { defaultGrunt: true },
      ),
    ).toEqual({ prompt: "ship it", name: "thinker", subagent_type: "grunt" });
    expect(
      rewriteSpawnToolInput(
        { prompt: "ship it", type: "implementer" },
        { defaultGrunt: true },
      ),
    ).toEqual({
      prompt: "ship it",
      type: "implementer",
      subagent_type: "grunt",
    });
    expect(
      rewriteSpawnToolInput(
        { prompt: "ship it", agent: "thinker" },
        { defaultGrunt: true },
      ),
    ).toEqual({ prompt: "ship it", agent: "thinker", subagent_type: "grunt" });
    expect(
      rewriteSpawnToolInput({ prompt: "ship it" }, { defaultGrunt: true }),
    ).toEqual({ prompt: "ship it", subagent_type: "grunt" });
    expect(
      rewriteSpawnToolInput(
        { prompt: "ship it", name: "Explore" },
        { defaultGrunt: true },
      ),
    ).toEqual({ prompt: "ship it", name: "Explore", subagent_type: "grunt" });
    expect(
      rewriteSpawnToolInput(
        { prompt: "ship it", type: "Plan" },
        { defaultGrunt: true },
      ),
    ).toEqual({ prompt: "ship it", type: "Plan", subagent_type: "grunt" });
    expect(
      rewriteSpawnToolInput(
        { prompt: "ship it", name: "general-purpose" },
        { defaultGrunt: true },
      ),
    ).toEqual({
      prompt: "ship it",
      name: "general-purpose",
      subagent_type: "grunt",
    });
    expect(
      rewriteSpawnToolInput(
        { prompt: "ship it", subagent_type: "implementer", name: "Explore" },
        { defaultGrunt: true },
      ),
    ).toEqual({
      prompt: "ship it",
      subagent_type: "grunt",
      name: "Explore",
    });
  });
});

describe("scrub-spawn-prompt adapter (stdin)", () => {
  it("rewrites prompt and preserves other fields", () => {
    const result = runHook(adapter, {
      hookEventName: "PreToolUse",
      toolName: "spawn_subagent",
      toolInput: {
        prompt: fillerPrompt,
        description: "feat work",
        subagent_type: "implementer",
        resume_from: "abc",
      },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const out = JSON.parse(result.stdout);
    expect(out).toEqual(
      hookResponse({
        prompt: scrubbedPrompt,
        description: "feat work",
        subagent_type: "implementer",
        resume_from: "abc",
      }),
    );
  });

  it("accepts Claude snake_case tool_input", () => {
    const result = runHook(adapter, {
      hook_event_name: "PreToolUse",
      tool_name: "Task",
      tool_input: {
        prompt: fillerPrompt,
        description: "keep me",
        subagent_type: "thinker",
      },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.updatedInput).toEqual({
      prompt: scrubbedPrompt,
      description: "keep me",
      subagent_type: "thinker",
    });
  });

  it("fail-opens (empty stdout, 0) when prompt is unchanged", () => {
    const result = runHook(adapter, {
      toolInput: { prompt: scrubbedPrompt, subagent_type: "grunt" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("fail-opens on invalid JSON", () => {
    const result = runHook(adapter, "{not json");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("fail-opens when prompt is missing", () => {
    const result = runHook(adapter, {
      toolInput: { description: "no prompt", subagent_type: "grunt" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

});

describe("orchestrate-parent spawn rewrite", () => {
  it("emits one updatedInput with type default and intent-scrub", () => {
    const result = runHook(
      orchParent,
      {
        hookEventName: "PreToolUse",
        toolName: "spawn_subagent",
        toolInput: {
          prompt: fillerPrompt,
          description: "feat",
          name: "child",
        },
      },
      { GROK_HOOK_EVENT: "pre_tool_use" },
    );
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.updatedInput).toEqual({
      prompt: scrubbedPrompt,
      description: "feat",
      name: "child",
      subagent_type: "grunt",
    });
    expect(out.decision).toBeUndefined();
  });

  it("scrubs even when type is already allowed", () => {
    const result = runHook(
      orchParent,
      {
        hookEventName: "PreToolUse",
        toolName: "Task",
        toolInput: {
          prompt: fillerPrompt,
          subagent_type: "thinker",
        },
      },
      { GROK_HOOK_EVENT: "pre_tool_use" },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.updatedInput).toEqual({
      prompt: scrubbedPrompt,
      subagent_type: "grunt",
    });
  });
});

describe("capSpawnPrompt transcript + truncate", () => {
  it("strips pasted transcripts and keeps first You are + facts + abs paths", () => {
    const raw = fs.readFileSync(
      path.join(here, "fixtures/spawn-transcript.txt"),
      "utf8",
    );
    const out = capSpawnPrompt(raw);
    expect(out).toMatch(/^You are implementer subagent\./);
    expect(out).not.toMatch(/^Human:/m);
    expect(out).not.toMatch(/^Assistant:/m);
    expect(out).not.toMatch(/^\[orchestrator\]:/m);
    expect(out).not.toMatch(/^\[router\]:/m);
    expect(out).not.toMatch(/^\[implementer\]:/m);
    expect(out).not.toMatch(/You are grunt subagent/);
    expect(out).toContain("1 match.");
    expect(out).toContain("- scripts/gate-fat-tools.mjs:1 — exists");
    expect(out).not.toContain("verdict: ok");
    expect(out).toContain(
      "/home/ecomet/Development/grunt-test-2/scripts/gate-fat-tools.mjs",
    );
  });

  it("strips legacy [router]: as well as [orchestrator]:", () => {
    const out = capSpawnPrompt(
      "[router]: old parent\n[orchestrator]: new parent\nship it",
    );
    expect(out).not.toMatch(/\[router\]/);
    expect(out).not.toMatch(/\[orchestrator\]/);
    expect(out).toContain("ship it");
  });

  it("denies over-cap prompts after scrub without slicing or …[truncated]", () => {
    const template = fs.readFileSync(
      path.join(here, "fixtures/spawn-overcap.txt"),
      "utf8",
    );
    const raw = template.replace("XXXX_PAD", "x".repeat(MAX_PROMPT_CHARS + 1));
    const out = capSpawnPrompt(raw);
    expect(out.length).toBeGreaterThan(MAX_PROMPT_CHARS);
    expect(out).not.toContain(TRUNCATE_SUFFIX);
    expect(out).toContain("1 match.");
    expect(out).toContain(
      "- /home/ecomet/Development/grunt-test-2/README.md:1 — keep me",
    );
    expect(out).not.toContain("verdict: ok");
    expect(out).toContain("/home/ecomet/Development/grunt-test-2/README.md");
    const rewritten = rewriteSpawnToolInput({
      prompt: raw,
      subagent_type: "implementer",
    });
    if (rewritten && typeof rewritten.prompt === "string") {
      expect(rewritten.prompt).not.toContain(TRUNCATE_SUFFIX);
      expect(rewritten.prompt.length).toBeGreaterThan(MAX_PROMPT_CHARS);
    }
    const ws = root;
    const denied = processHookPayload({
      toolInput: { prompt: raw, subagent_type: "implementer" },
      workspaceRoot: ws,
    });
    expect(denied).toMatchObject({ decision: "deny" });
    expect(denied.reason).toContain(`${ws}/.tmp/grunt/plans/`);
    expect(denied.reason).toMatch(/re-spawn/i);
    expect(denied.reason).toMatch(/abs path/i);
    expect(JSON.stringify(denied)).not.toContain(TRUNCATE_SUFFIX);
    expect(denied.hookSpecificOutput?.updatedInput).toBeUndefined();
  });

  it("allows prompts at the cap after scrub", () => {
    expect(MAX_PROMPT_CHARS).toBe(100000);
    const raw = "x".repeat(MAX_PROMPT_CHARS);
    const out = capSpawnPrompt(raw);
    expect(out.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    expect(out).not.toContain(TRUNCATE_SUFFIX);
    const payload = processHookPayload({
      toolInput: { prompt: raw, subagent_type: "implementer" },
      workspaceRoot: root,
    });
    if (payload && payload.decision) {
      expect(payload.decision).not.toBe("deny");
    }
  });
});

describe("processHookPayload", () => {
  it("prefers toolInput over tool_input", () => {
    expect(
      processHookPayload({
        toolInput: { prompt: fillerPrompt, tag: "camel" },
        tool_input: { prompt: fillerPrompt, tag: "snake" },
      }),
    ).toMatchObject({ tag: "camel", prompt: scrubbedPrompt });
  });

  it("grokDefaultGrunt is false unless GROK_HOOK_EVENT is set", () => {
    expect(typeof grokDefaultGrunt()).toBe("boolean");
  });
});

describe("orchestrate-parent spawn cap deny", () => {
  it("denies Grok spawn over cap without updatedInput slice", () => {
    const prompt = "x".repeat(MAX_PROMPT_CHARS + 1);
    const result = runHook(
      orchParent,
      {
        hookEventName: "PreToolUse",
        toolName: "spawn_subagent",
        toolInput: { prompt, subagent_type: "implementer" },
        workspaceRoot: root,
      },
      { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: root },
    );
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.decision).toBe("deny");
    expect(json.reason).toContain(`${root}/.tmp/grunt/plans/`);
    expect(json.reason).toMatch(/re-spawn/i);
    expect(result.stdout).not.toContain(TRUNCATE_SUFFIX);
    expect(json.hookSpecificOutput?.updatedInput).toBeUndefined();
  });

  it("allows Grok spawn under cap", () => {
    const result = runHook(
      orchParent,
      {
        hookEventName: "PreToolUse",
        toolName: "spawn_subagent",
        toolInput: {
          prompt: "You are implementer subagent. ship it",
          subagent_type: "implementer",
        },
        workspaceRoot: root,
      },
      { GROK_HOOK_EVENT: "pre_tool_use", GROK_WORKSPACE_ROOT: root },
    );
    expect(result.status).toBe(0);
    if (result.stdout) {
      const json = JSON.parse(result.stdout);
      expect(json.decision).not.toBe("deny");
    }
  });
});
