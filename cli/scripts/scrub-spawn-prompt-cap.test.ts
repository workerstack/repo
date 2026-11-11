import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { runHook } from "./__fixtures__/run-hook.ts";
import { here, parseOut, plansRoot, root } from "./__fixtures__/scrub-kit.ts";
import { main as orchMain } from "./orchestrate-parent.ts";
import {
  MAX_PROMPT_CHARS,
  TRUNCATE_SUFFIX,
  capSpawnPrompt,
  processHookPayload,
  rewriteSpawnToolInput,
} from "./scrub-spawn-prompt.ts";

it("strips pasted transcripts and keeps first You are + facts + abs paths", () => {
  const raw = fs.readFileSync(path.join(here, "__fixtures__/spawn-transcript.txt"), "utf8");
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
  const template = fs.readFileSync(path.join(here, "__fixtures__/spawn-overcap.txt"), "utf8");
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
  expect(rewritten?.prompt).not.toContain(TRUNCATE_SUFFIX);
  expect(String(rewritten?.prompt).length).toBeGreaterThan(MAX_PROMPT_CHARS);
  const ws = root;
  const denied = processHookPayload({
    toolInput: { prompt: raw, subagent_type: "scout" },
    workspaceRoot: ws,
  });
  expect(denied).toMatchObject({ decision: "block" });
  expect(denied?.reason).toContain(`${plansRoot}/.tmp/repo/plans/`);
  expect(denied?.reason).toMatch(/re-spawn/i);
  expect(denied?.reason).toMatch(/abs path/i);
  expect(JSON.stringify(denied)).not.toContain(TRUNCATE_SUFFIX);
  expect(denied?.hookSpecificOutput?.updatedInput).toBeUndefined();
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
  expect(payload?.decision).not.toBe("block");
});

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
  expect(result.stdout === "" ? undefined : parseOut(result.stdout).decision).not.toBe("block");
});
