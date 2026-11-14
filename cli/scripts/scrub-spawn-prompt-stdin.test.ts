import { expect, it } from "vitest";

import { AGENT_DEFAULTS } from "../agent-defaults.constants.ts";
import { runHook } from "./__fixtures__/run-hook.ts";
import { FILLER_PROMPT, parseOut, scrubbedPrompt } from "./__fixtures__/scrub-kit.ts";
import { mainWith } from "./orchestrate-parent.ts";
import { main } from "./scrub-spawn-prompt.ts";

/** The parent hook on the built-in agents defaults, answered in this process. */
const orchMain = mainWith(AGENT_DEFAULTS);

it("rewrites prompt and preserves other fields", () => {
  const result = runHook(main, {
    hookEventName: "PreToolUse",
    toolInput: {
      description: "feat work",
      prompt: FILLER_PROMPT,
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
      prompt: FILLER_PROMPT,
      subagent_type: "thinker",
    },
    tool_name: "Task",
  });

  expect(result.status).toBe(0);
  expect(parseOut(result.stdout).hookSpecificOutput?.updatedInput).toStrictEqual({
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

it("scrubs prompt and does not inject a type", () => {
  const result = runHook(
    orchMain,
    {
      hookEventName: "PreToolUse",
      toolInput: {
        description: "feat",
        name: "child",
        prompt: FILLER_PROMPT,
      },
      toolName: "spawn_subagent",
    },
    { GROK_HOOK_EVENT: "pre_tool_use" },
  );

  expect(result.status).toBe(0);
  const out = parseOut(result.stdout);
  expect(out.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
  expect(out.hookSpecificOutput?.updatedInput).toStrictEqual({
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
        prompt: FILLER_PROMPT,
        subagent_type: "Explore",
      },
      toolName: "Task",
    },
    { GROK_HOOK_EVENT: "pre_tool_use" },
  );

  expect(result.status).toBe(0);
  expect(parseOut(result.stdout).hookSpecificOutput?.updatedInput).toStrictEqual({
    prompt: scrubbedPrompt,
    subagent_type: "Explore",
  });
});
