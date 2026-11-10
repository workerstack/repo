import { expect, it, vi } from "vitest";
import { renderTrees } from "./trees.ts";
import {
  RENDER_TIMEOUT,
  consumer,
  context,
  json,
  render,
  stagesIn,
  text,
  type ClaudeSettings,
  type McpFile,
} from "./fixtures/trees-kit.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();
vi.setConfig({ testTimeout: RENDER_TIMEOUT });

const SETTINGS = ".claude/settings.json";

it("merges .repo/settings/claude.json into .claude/settings.json", () => {
  const root = consumer({
    ".repo/settings/claude.json": JSON.stringify({
      env: { MINE: "1" },
      enableAllProjectMcpServers: true,
      permissions: { allow: ["Bash(ls:*)"], deny: ["Agent(Explore)", "Read(./secret)"] },
    }),
  });
  const settings = json<ClaudeSettings>(render(root, ["claude"]), SETTINGS);
  expect(settings.env).toEqual({ MINE: "1" });
  expect(settings.permissions.allow).toContain("Bash(ls:*)");
  expect(settings.enableAllProjectMcpServers).toBe(true);
  expect(settings.permissions.deny.filter((rule) => rule === "Agent(Explore)")).toHaveLength(1);
  expect(settings.permissions.deny).toContain("Read(./secret)");
  expect(Object.keys(settings.hooks).length).toBeGreaterThan(0);
});

it("appends .repo hooks after the generated ones and never repeats a stock hook", () => {
  const plain = json<ClaudeSettings>(render(consumer(), ["claude"]), SETTINGS);
  const stockGroup = plain.hooks.PreToolUse[0];
  const mine = { matcher: "Write", hooks: [{ type: "command", command: "make post-write", timeout: 5 }] };
  const root = consumer({
    ".repo/settings/claude.json": JSON.stringify({ hooks: { PreToolUse: [stockGroup], PostToolUse: [mine] } }),
  });
  const settings = json<ClaudeSettings>(render(root, ["claude"]), SETTINGS);
  expect(settings.hooks.PreToolUse).toEqual(plain.hooks.PreToolUse);
  expect(settings.hooks.PostToolUse).toEqual([...(plain.hooks.PostToolUse ?? []), mine]);
  expect(settings.hooks.PostToolUse?.at(-1)).toEqual(mine);
});

it("reports an unreadable .repo/settings/claude.json", () => {
  const root = consumer({ ".repo/settings/claude.json": "{" });
  const result = renderTrees(context(root, ["claude"]));
  expect(result).toEqual({ ok: false, errors: [expect.stringContaining(".repo/settings/claude.json")] });
  expect(stagesIn(root)).toEqual([]);
});

it("reports a .repo/settings/claude.json that is not an object", () => {
  const root = consumer({ ".repo/settings/claude.json": "[]" });
  expect(renderTrees(context(root, ["claude"]))).toEqual({
    ok: false,
    errors: [expect.stringContaining("must be a JSON object")],
  });
});

it("deep-merges .repo/mcp.json over the generated .mcp.json", () => {
  const server = { command: "npx", args: ["-y", "mine"] };
  const root = consumer({ ".repo/mcp.json": JSON.stringify({ mcpServers: { mine: server } }) });
  const mcp = json<McpFile>(render(root, ["claude"]), ".mcp.json");
  expect(mcp.mcpServers.mine).toEqual(server);
  expect(json<McpFile>(render(consumer(), ["claude"]), ".mcp.json").mcpServers.mine).toBeUndefined();
});

it("reports an unreadable .repo/mcp.json, and one that is not an object", () => {
  expect(renderTrees(context(consumer({ ".repo/mcp.json": "{" }), ["claude"]))).toEqual({
    ok: false,
    errors: [expect.stringContaining(".repo/mcp.json")],
  });
  expect(renderTrees(context(consumer({ ".repo/mcp.json": "[]" }), ["claude"]))).toEqual({
    ok: false,
    errors: [".repo/mcp.json: must be a JSON object"],
  });
});

it("ignores .repo/mcp.json when claude is off", () => {
  expect(renderTrees(context(consumer({ ".repo/mcp.json": "{" }), ["codex"])).ok).toBe(true);
});

it("reports an emit step that rejects the merged mcp policy", () => {
  const root = consumer({ ".repo/mcp-policy.jsonc": '{ "allow": 5 }' });
  expect(renderTrees(context(root, ["claude"]))).toEqual({
    ok: false,
    errors: ["mcp policy: allow must be an array"],
  });
  expect(stagesIn(root)).toEqual([]);
});

it("ignores .repo/settings/claude.json when claude is off", () => {
  const root = consumer({ ".repo/settings/claude.json": "{" });
  expect(renderTrees(context(root, ["codex"])).ok).toBe(true);
});

it("keeps a consumer scripts/ hook and a .repo/permissions.json deny in the hook files", () => {
  const root = consumer({
    "scripts/daily-pull-check.mjs": "// pull\n",
    ".repo/permissions.json": JSON.stringify({ deny: ["Edit(./vendor/**)"] }),
  });
  const outputs = render(root, ["claude", "codex"]);
  expect(text(outputs, SETTINGS)).toContain("daily-pull-check.mjs");
  expect(text(outputs, SETTINGS)).toContain("Edit(./vendor/**)");
  expect(text(outputs, ".codex/hooks.json")).toContain("daily-pull-check.mjs");
});

it("merges a .repo/mcp-policy.jsonc over the stock policy", () => {
  const root = consumer({
    ".repo/mcp-policy.jsonc": '{ "allow": ["mine"], "servers": { "mine": { "command": "x" } } }',
  });
  expect(json<McpFile>(render(root, ["claude"]), ".mcp.json").mcpServers).toHaveProperty("mine");
});
