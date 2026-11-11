import { expect, it } from "vitest";

import type { Host } from "../../config.ts";
import { EVERY_FIELD, at, keysAt, renderOne } from "../__fixtures__/hooks-kit.ts";

/** The one hook a single-definition render wrote: cursor's flat entry, else the first group's first handler. */
function firstHook(host: Host, hooks: unknown): unknown {
  return host === "cursor" ? at(hooks, "preToolUse", 0) : at(hooks, keysAt(hooks)[0] ?? "", 0, "hooks", 0);
}

it.each([
  [
    "claude",
    [
      "once",
      "async",
      "asyncRewake",
      "continueOnBlock",
      "onFailure",
      "if",
      "statusMessage",
      "shell",
      "args",
      "command",
      "timeout",
      "type",
    ],
  ],
  ["codex", ["async", "additionalContextLimit", "commandWindows", "statusMessage", "command", "timeout", "type"]],
  ["antigravity", ["command", "timeout", "type"]],
  ["cursor", ["command", "failClosed", "loop_limit", "matcher", "timeout"]],
] as const)(
  "%s writes its passthrough fields in rulesync's order, then the handler's own fields sorted",
  (host, keys) => {
    const hooks = renderOne(host, "preToolUse", { ...EVERY_FIELD, command: "c", matcher: "Bash", timeout: 5 });
    const hook = firstHook(host, hooks);
    expect(keysAt(hook)).toStrictEqual(keys);
    expect(at(hook, "onFailure")).toBe(host === "claude" ? "block" : undefined);
  },
);

/** The first preToolUse handler a matcher-group host wrote for `def`. */
function preToolUse(host: Host, def: Record<string, unknown>): unknown {
  return at(renderOne(host, "preToolUse", def), "PreToolUse", 0, "hooks", 0);
}

it("drops command-only fields from other hook types and values of the wrong kind", () => {
  const claude = preToolUse("claude", { type: "http", url: "u", ...EVERY_FIELD, once: "yes", statusMessage: "" });
  expect(claude).toStrictEqual({
    continueOnBlock: true,
    if: "Bash(git *)",
    onFailure: "block",
    type: "http",
    url: "u",
  });
  const codex = preToolUse("codex", { server: "s", tool: "t", type: "mcp_tool", ...EVERY_FIELD });
  expect(codex).toStrictEqual({ server: "s", statusMessage: "m", tool: "t", type: "mcp_tool" });
  const invalid = preToolUse("codex", { additionalContextLimit: Infinity, args: [1], async: "yes", command: "c" });
  expect(invalid).toStrictEqual({ command: "c", type: "command" });
  expect(preToolUse("claude", { args: ["a", 1], command: "c" })).toStrictEqual({ command: "c", type: "command" });
});

const IGNORED = ["stop", "subagentStop", "taskCompleted", "teammateIdle"].map((event) => ({
  def: { command: "c" },
  event,
  name: `the ${event} event`,
  written: false,
}));

it.each([
  { def: { command: "c" }, event: "preToolUse", name: "a command hook", written: true },
  { def: { type: "http", url: "u" }, event: "preToolUse", name: "an http hook", written: true },
  { def: { prompt: "p", type: "prompt" }, event: "preToolUse", name: "a prompt hook", written: false },
  { def: { command: "c", failClosed: false }, event: "preToolUse", name: "a false value", written: false },
  ...IGNORED,
  { def: { async: true, command: "c" }, event: "preToolUse", name: "an async command hook", written: false },
  {
    def: { asyncRewake: true, command: "c" },
    event: "preToolUse",
    name: "an asyncRewake command hook",
    written: false,
  },
  {
    def: { async: true, type: "http", url: "u" },
    event: "preToolUse",
    name: "an http hook with async set",
    written: true,
  },
])("writes claude's onFailure from failClosed on $name: $event", ({ event, def, written }) => {
  const hooks = renderOne("claude", event, { failClosed: true, ...def });
  expect(at(hooks, keysAt(hooks)[0] ?? "", 0, "hooks", 0, "onFailure")).toBe(written ? "block" : undefined);
});

/** The command claude wrote for an exec-form hook running `value`. */
function execCommand(value: string): unknown {
  return at(preToolUse("claude", { args: [], command: value }), "command");
}

it("prefixes a leading ./ of an exec-form claude command with the braced project dir, quotes stripped", () => {
  expect(execCommand("./a.sh")).toBe("${CLAUDE_PROJECT_DIR}/a.sh");
  expect(execCommand("'./q r.sh'")).toBe("${CLAUDE_PROJECT_DIR}/q r.sh");
  expect(execCommand(`"./half`)).toBe("${CLAUDE_PROJECT_DIR}/half");
  expect(execCommand("bin/x")).toBe("bin/x");
});
