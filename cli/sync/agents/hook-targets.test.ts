import { expect, it } from "vitest";

import type { Json } from "../../json.ts";
import { hooksOf, keysAt, parsed } from "../__fixtures__/hooks-kit.ts";
import { renderHooks } from "./render-hooks.ts";

it("writes each claude hook type with its payload, drops other types and keeps an existing $schema", () => {
  const preToolUse: Json[] = [
    { allowedEnvVars: ["E"], headers: { a: "b" }, timeout: null, type: "http", url: "u" },
    { input: { k: 1 }, server: "s", tool: "t", type: "mcp_tool" },
    { model: "m", prompt: "p", timeout: 9, type: "prompt" },
    { model: null, prompt: "q", type: "agent" },
    { command: "dropped", type: "other" },
  ];

  const sources = hooksOf({ hooks: { preToolUse, stop: [{ command: "dropped", type: "other" }] } });
  const claude = parsed(renderHooks(sources, ["claude"], '{"a":1,"$schema":"own"}'), ".claude/settings.json");
  // An existing $schema keeps its place.
  expect(keysAt(claude)).toStrictEqual(["a", "$schema", "hooks"]);
  expect(claude).toStrictEqual({
    $schema: "own",
    a: 1,
    hooks: {
      PreToolUse: [
        {
          hooks: [
            { allowedEnvVars: ["E"], headers: { a: "b" }, type: "http", url: "u" },
            { input: { k: 1 }, server: "s", tool: "t", type: "mcp_tool" },
            { model: "m", prompt: "p", timeout: 9, type: "prompt" },
            { prompt: "q", type: "agent" },
          ],
        },
      ],
    },
  });
});

const CODEX_DEFS: Json[] = [
  { command: "c", description: "d", name: "n", timeout: 1 },
  { input: { k: [1] }, server: "s", tool: "t", type: "mcp_tool" },
  { prompt: "unsupported", type: "prompt" },
  { command: "negative", timeout: -1 },
  { command: "fraction", timeout: 1.5 },
  { command: "text", timeout: "5" },
  { tool: "t", type: "mcp_tool" },
  { server: "s", tool: "", type: "mcp_tool" },
  { input: { k: [null] }, server: "s", tool: "t", type: "mcp_tool" },
];

it("writes codex name and description last and drops handlers codex refuses", () => {
  const sources = hooksOf({
    codexcli: { hooks: { worktreeCreate: [{ command: "w" }] } },
    hooks: { preToolUse: CODEX_DEFS, stop: [{ command: "gone", timeout: -1 }] },
  });

  const codex = parsed(renderHooks(sources, ["codex"], "{}"), ".codex/hooks.json");
  expect(codex).toStrictEqual({
    hooks: {
      PreToolUse: [
        {
          hooks: [
            { command: "c", description: "d", name: "n", timeout: 1, type: "command" },
            { input: { k: [1] }, server: "s", tool: "t", type: "mcp_tool" },
          ],
        },
      ],
      worktreeCreate: [{ hooks: [{ command: "w", type: "command" }] }],
    },
  });
  expect(keysAt(codex, "hooks", "PreToolUse", 0, "hooks", 0)).toStrictEqual([
    "command",
    "timeout",
    "type",
    "name",
    "description",
  ]);
});

it("flattens antigravity's matcher-less events untranslated and translates only whole tool names elsewhere", () => {
  const sources = hooksOf({
    hooks: {
      postToolUse: [
        { command: "p", matcher: "Bash|\\bRead|[Edit]|MyBash|Grep" },
        { prompt: "dropped", type: "prompt" },
      ],
      preModelInvocation: [{ command: "m" }],
      sessionStart: [{ command: "s", matcher: "Bash" }],
    },
  });

  expect(parsed(renderHooks(sources, ["antigravity"], "{}"), ".agents/hooks.json")).toStrictEqual({
    rulesync: {
      PostToolUse: [
        {
          hooks: [{ command: "p", type: "command" }],
          matcher: "run_command|\\b(?:read_file|view_file)|[Edit]|MyBash|Grep",
        },
      ],
      PreInvocation: [{ command: "m", type: "command" }],
      SessionStart: [{ command: "s", type: "command" }],
    },
  });
});
