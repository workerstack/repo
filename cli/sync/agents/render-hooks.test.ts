import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HOSTS, type Host } from "../../config.ts";
import {
  BASE_REL,
  CONSUMER,
  GOLDEN,
  HOOK_FILES,
  ROOT,
  STOCK,
  afterStage,
  at,
  hooksOf,
  keysAt,
  parsed,
} from "../__fixtures__/hooks-kit.ts";
import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { loadSources } from "./load-sources.ts";
import { renderHooks } from "./render-hooks.ts";

useTempDirs();

const cases = [
  { consumer: CONSUMER, expected: GOLDEN, name: "the consumer fixture over the frozen stock", stock: STOCK },
  { consumer: ROOT, expected: ROOT, name: "this repo", stock: ROOT },
];

describe.each(cases)("hooks of $name", ({ stock, consumer, expected }) => {
  function render(hosts: readonly Host[] = HOSTS): Map<string, string> {
    return renderHooks(
      loadSources({ consumerRoot: consumer, packages: [], stockRoot: stock }).sources,
      hosts,
      fs.readFileSync(path.join(stock, BASE_REL), "utf8"),
    );
  }

  it("give the golden bytes once the MCP policy and hooks union ran over them", () => {
    const files = render();
    expect([...files.keys()]).toStrictEqual(HOOK_FILES);
    const staged = afterStage(files, { consumer, stock });

    for (const rel of HOOK_FILES) expect(staged.get(rel), rel).toBe(fs.readFileSync(path.join(expected, rel), "utf8"));
  });

  it("write only the files of the enabled hosts", () => {
    expect([...render(["grok"]).keys()]).toStrictEqual([]);
    expect([...render(["codex", "cursor"]).keys()]).toStrictEqual([".codex/hooks.json", ".cursor/hooks.json"]);
    expect([...render(["antigravity"]).keys()]).toStrictEqual([".agents/hooks.json"]);
  });
});

it("prefixes only a leading ./ in claude commands with the project dir", () => {
  const preToolUse = [
    { command: "./a.sh x", matcher: "Bash" },
    { command: "'./q r.sh'", matcher: "Bash" },
    { command: "bun ./a.ts", matcher: "Bash" },
  ];

  const files = renderHooks(hooksOf({ hooks: { preToolUse } }), ["claude", "codex"], "{}");
  const claude = parsed(files, ".claude/settings.json");
  expect(keysAt(claude)).toStrictEqual(["$schema", "hooks"]);
  expect(at(claude, "hooks", "PreToolUse")).toStrictEqual([
    {
      hooks: [
        { command: '"$CLAUDE_PROJECT_DIR"/a.sh x', type: "command" },
        { command: `"$CLAUDE_PROJECT_DIR"/'q r.sh'`, type: "command" },
        { command: "bun ./a.ts", type: "command" },
      ],
      matcher: "Bash",
    },
  ]);
  expect(at(parsed(files, ".codex/hooks.json"), "hooks", "PreToolUse", 0, "hooks", 0, "command")).toBe("./a.sh x");
});

it("replaces a shared event in place with the target override and appends new override events", () => {
  const files = renderHooks(
    hooksOf({
      claudecode: { hooks: { notification: [{ command: "n" }], stop: [{ command: "override-stop" }] } },
      hooks: { preToolUse: [{ command: "r", matcher: "Read" }], stop: [{ command: "shared-stop" }] },
    }),
    ["claude", "antigravity"],
    '{"hooks":{"Old":[]},"z":1}',
  );

  const claude = parsed(files, ".claude/settings.json");
  expect(keysAt(claude)).toStrictEqual(["$schema", "hooks", "z"]);
  expect(keysAt(claude, "hooks")).toStrictEqual(["PreToolUse", "Stop", "Notification"]);
  expect(at(claude, "hooks", "Stop")).toStrictEqual([{ hooks: [{ command: "override-stop", type: "command" }] }]);
  expect(parsed(files, ".agents/hooks.json")).toStrictEqual({
    rulesync: {
      PreToolUse: [{ hooks: [{ command: "r", type: "command" }], matcher: "(?:read_file|view_file)" }],
      Stop: [{ command: "shared-stop", type: "command" }],
    },
  });
});

it("writes an empty antigravity object and cursor version 1 when there are no hooks", () => {
  const files = renderHooks(hooksOf({}), ["antigravity", "cursor"], "{}");
  expect(files.get(".agents/hooks.json")).toBe("{}\n");
  expect(parsed(files, ".cursor/hooks.json")).toStrictEqual({ hooks: {}, version: 1 });
});

it("maps cursor entries flat, keeping command and prompt handlers only", () => {
  const stop = [
    { command: "a", failClosed: true, loop_limit: 3, matcher: "", timeout: null },
    { loop_limit: null, model: "x", prompt: "p", timeout: 3, type: "prompt" },
    { command: "b", model: "ignored", type: "command" },
    { command: "dropped", type: "agent" },
  ];

  const files = renderHooks(
    hooksOf({
      cursor: { hooks: { customEvent: [{ command: "c" }] } },
      hooks: { sessionEnd: [{ command: "dropped", type: "agent" }], stop },
      version: 2,
    }),
    ["cursor"],
    "{}",
  );

  // A target override's new event follows the shared ones.
  expect(files.get(".cursor/hooks.json")).toMatch(/"stop"[\s\S]*"customEvent"/);
  expect(parsed(files, ".cursor/hooks.json")).toStrictEqual({
    hooks: {
      customEvent: [{ command: "c" }],
      stop: [
        { command: "a", failClosed: true, loop_limit: 3, matcher: "" },
        { loop_limit: null, model: "x", prompt: "p", timeout: 3, type: "prompt" },
        { command: "b", type: "command" },
      ],
    },
    version: 2,
  });
});
