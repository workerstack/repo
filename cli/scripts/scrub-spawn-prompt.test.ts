import { expect, it } from "vitest";

import { spawnHook } from "./__fixtures__/run-hook.ts";
import { FILLER_PROMPT, parseOut, scrubbedPrompt } from "./__fixtures__/scrub-kit.ts";
import { processHookPayload, rewriteSpawnToolInput } from "./scrub-spawn-prompt.ts";

it("scrubs prompt with intent and preserves other fields", () => {
  const updated = rewriteSpawnToolInput({
    description: "build it",
    name: "feat",
    prompt: FILLER_PROMPT,
    subagent_type: "scout",
  });

  expect(updated).toStrictEqual({
    description: "build it",
    name: "feat",
    prompt: scrubbedPrompt,
    subagent_type: "scout",
  });
  expect(updated?.prompt).not.toBe(FILLER_PROMPT);
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
      prompt: FILLER_PROMPT,
      subagent_type: "Explore",
    }),
  ).toStrictEqual({ prompt: scrubbedPrompt, subagent_type: "Explore" });
  expect(
    rewriteSpawnToolInput({
      prompt: FILLER_PROMPT,
      type: "Plan",
    }),
  ).toStrictEqual({ prompt: scrubbedPrompt, type: "Plan" });
  expect(rewriteSpawnToolInput({ prompt: FILLER_PROMPT })).toStrictEqual({
    prompt: scrubbedPrompt,
  });
});

it("scrubs a spawn prompt through the real entry", () => {
  const result = spawnHook("scrub-spawn-prompt", {
    hookEventName: "PreToolUse",
    toolInput: { description: "feat work", prompt: FILLER_PROMPT },
    toolName: "spawn_subagent",
  });

  expect(result.status, result.stderr).toBe(0);
  expect(parseOut(result.stdout).hookSpecificOutput?.updatedInput).toStrictEqual({
    description: "feat work",
    prompt: scrubbedPrompt,
  });
});

it("prefers toolInput over tool_input", () => {
  expect(
    processHookPayload({
      toolInput: { prompt: FILLER_PROMPT, tag: "camel" },
      tool_input: { prompt: FILLER_PROMPT, tag: "snake" },
    }),
  ).toMatchObject({ hookSpecificOutput: { updatedInput: { prompt: scrubbedPrompt, tag: "camel" } } });
});

it("answers a Codex spawn rewrite with allow and a Claude one without", () => {
  const codex = processHookPayload({
    model: "m",
    tool_input: { prompt: FILLER_PROMPT },
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
  const claude = processHookPayload({ tool_input: { prompt: FILLER_PROMPT }, tool_name: "Agent" });
  expect(
    processHookPayload({ tool_input: { prompt: FILLER_PROMPT }, tool_name: "Agent", turn_id: "t1" }),
  ).toStrictEqual(claude);
  expect(claude).toStrictEqual({
    hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { prompt: scrubbedPrompt } },
  });
});
