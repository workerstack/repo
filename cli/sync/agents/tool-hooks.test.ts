import { expect, it } from "vitest";

import { HOSTS } from "../../config.ts";
import type { Json } from "../../json.ts";
import { at, hooksOf, keysAt, parsed } from "../__fixtures__/hooks-kit.ts";
import { renderHooks } from "./render-hooks.ts";

const CLAUDE_PAIRS: readonly (readonly [string, string])[] = [
  ["beforeSubmitPrompt", "UserPromptSubmit"],
  ["configChange", "ConfigChange"],
  ["cwdChanged", "CwdChanged"],
  ["directoryAdded", "DirectoryAdded"],
  ["elicitation", "Elicitation"],
  ["elicitationResult", "ElicitationResult"],
  ["fileChanged", "FileChanged"],
  ["instructionsLoaded", "InstructionsLoaded"],
  ["messageDisplay", "MessageDisplay"],
  ["notification", "Notification"],
  ["permissionDenied", "PermissionDenied"],
  ["permissionRequest", "PermissionRequest"],
  ["postCompact", "PostCompact"],
  ["postModelSwitch", "PostModelSwitch"],
  ["postToolBatch", "PostToolBatch"],
  ["postToolUse", "PostToolUse"],
  ["postToolUseFailure", "PostToolUseFailure"],
  ["preCompact", "PreCompact"],
  ["preModelSwitch", "PreModelSwitch"],
  ["preToolUse", "PreToolUse"],
  ["sessionEnd", "SessionEnd"],
  ["sessionStart", "SessionStart"],
  ["setup", "Setup"],
  ["stop", "Stop"],
  ["stopFailure", "StopFailure"],
  ["subagentStart", "SubagentStart"],
  ["subagentStop", "SubagentStop"],
  ["taskCompleted", "TaskCompleted"],
  ["taskCreated", "TaskCreated"],
  ["teammateIdle", "TeammateIdle"],
  ["userPromptExpansion", "UserPromptExpansion"],
  ["worktreeCreate", "WorktreeCreate"],
  ["worktreeRemove", "WorktreeRemove"],
];

const CODEX_PAIRS: readonly (readonly [string, string])[] = [
  ["beforeSubmitPrompt", "UserPromptSubmit"],
  ["permissionRequest", "PermissionRequest"],
  ["postCompact", "PostCompact"],
  ["postModelInvocation", "PostModelRequest"],
  ["postToolUse", "PostToolUse"],
  ["preCompact", "PreCompact"],
  ["preModelInvocation", "PreModelRequest"],
  ["preToolUse", "PreToolUse"],
  ["sessionEnd", "SessionEnd"],
  ["sessionStart", "SessionStart"],
  ["stop", "Stop"],
  ["stopCancelled", "Interrupt"],
  ["subagentStart", "SubagentStart"],
  ["subagentStop", "SubagentStop"],
];

const ANTIGRAVITY_PAIRS: readonly (readonly [string, string])[] = [
  ["postModelInvocation", "PostInvocation"],
  ["postToolUse", "PostToolUse"],
  ["preModelInvocation", "PreInvocation"],
  ["preToolUse", "PreToolUse"],
  ["sessionStart", "SessionStart"],
  ["stop", "Stop"],
];

const CURSOR_NAMES =
  "sessionStart sessionEnd preToolUse postToolUse beforeSubmitPrompt stop subagentStop preCompact postToolUseFailure " +
  "subagentStart beforeShellExecution afterShellExecution beforeMCPExecution afterMCPExecution beforeReadFile " +
  "afterFileEdit afterAgentResponse afterAgentThought beforeTabFileRead afterTabFileEdit workspaceOpen";

const CLAUDE_NO_MATCHER =
  "worktreeCreate worktreeRemove messageDisplay postToolBatch taskCreated taskCompleted teammateIdle cwdChanged " +
  "beforeSubmitPrompt stop";

it("translates every event of each host's map and skips the events a host lacks", () => {
  const cursorEvents = CURSOR_NAMES.split(" ");
  const sources = [CLAUDE_PAIRS, CODEX_PAIRS].flatMap((pairs) => pairs.map(([event]) => event));
  const events = [...new Set([...sources, ...cursorEvents, "unknownEvent"])];

  const files = renderHooks(
    hooksOf({ hooks: Object.fromEntries(events.map((event) => [event, [{ command: "c" }]])) }),
    HOSTS,
    "{}",
  );

  function toolNames(pairs: readonly (readonly [string, string])[]): string[] {
    const map = new Map(pairs);

    return events.flatMap((event) => map.get(event) ?? []);
  }

  expect(keysAt(parsed(files, ".claude/settings.json"), "hooks")).toStrictEqual(toolNames(CLAUDE_PAIRS));
  expect(keysAt(parsed(files, ".codex/hooks.json"), "hooks")).toStrictEqual(toolNames(CODEX_PAIRS));
  expect(keysAt(parsed(files, ".agents/hooks.json"), "rulesync")).toStrictEqual(toolNames(ANTIGRAVITY_PAIRS));
  expect(keysAt(parsed(files, ".cursor/hooks.json"), "hooks")).toStrictEqual(
    events.filter((event) => cursorEvents.includes(event)),
  );
});

it("drops the matcher on claude's matcher-less events but keeps each matcher's group apart", () => {
  const noMatcher = CLAUDE_NO_MATCHER.split(" ");

  const files = renderHooks(
    hooksOf({
      hooks: Object.fromEntries(
        [...noMatcher, "subagentStop"].map((event): [string, Json] => [
          event,
          [{ command: "a", matcher: "x" }, { command: "b" }],
        ]),
      ),
    }),
    ["claude"],
    "{}",
  );

  const hooks = at(parsed(files, ".claude/settings.json"), "hooks");
  const split = [{ hooks: [{ command: "a", type: "command" }] }, { hooks: [{ command: "b", type: "command" }] }];

  for (const name of keysAt(hooks).filter((key) => key !== "SubagentStop"))
    expect(at(hooks, name), name).toStrictEqual(split);
  expect(keysAt(hooks)).toHaveLength(noMatcher.length + 1);
  expect(at(hooks, "SubagentStop")).toStrictEqual([
    { hooks: [{ command: "a", type: "command" }], matcher: "x" },
    split[1],
  ]);
});
