import { expect, it, vi } from "vitest";

import { HOSTS } from "../config.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";
import {
  RENDER_TIMEOUT,
  consumer,
  context,
  find,
  json,
  render,
  stagesIn,
  text,
  type ClaudeSettings,
  type McpFile,
} from "./__fixtures__/trees-kit.ts";
import { renderTrees } from "./trees.ts";

useTempDirs();
vi.setConfig({ testTimeout: RENDER_TIMEOUT });

const SETTINGS = ".claude/settings.json";

it("merges .repo/settings/claude.json into .claude/settings.json", () => {
  const root = consumer({
    ".repo/settings/claude.json": JSON.stringify({
      enableAllProjectMcpServers: true,
      env: { MINE: "1" },
      permissions: { allow: ["Bash(ls:*)"], deny: ["Agent(Explore)", "Read(./secret)"] },
    }),
  });
  const settings = json<ClaudeSettings>(render(root, ["claude"]), SETTINGS);
  expect(settings.env).toStrictEqual({ MINE: "1" });
  expect(settings.permissions.allow).toContain("Bash(ls:*)");
  expect(settings.enableAllProjectMcpServers).toBe(true);
  expect(settings.permissions.deny.filter((rule) => rule === "Agent(Explore)")).toHaveLength(1);
  expect(settings.permissions.deny).toContain("Read(./secret)");
  expect(Object.keys(settings.hooks).length).toBeGreaterThan(0);
});

it("appends .repo hooks after the generated ones and never repeats a stock hook", () => {
  const plain = json<ClaudeSettings>(render(consumer(), ["claude"]), SETTINGS);
  const stockGroup = plain.hooks.PreToolUse[0];
  const mine = { hooks: [{ command: "make post-write", timeout: 5, type: "command" }], matcher: "Write" };
  const root = consumer({
    ".repo/settings/claude.json": JSON.stringify({ hooks: { PostToolUse: [mine], PreToolUse: [stockGroup] } }),
  });
  const settings = json<ClaudeSettings>(render(root, ["claude"]), SETTINGS);
  expect(settings.hooks.PreToolUse).toStrictEqual(plain.hooks.PreToolUse);
  expect(settings.hooks.PostToolUse).toStrictEqual([...(plain.hooks.PostToolUse ?? []), mine]);
  expect(settings.hooks.PostToolUse?.at(-1)).toStrictEqual(mine);
});

it("reports an unreadable .repo/settings/claude.json", () => {
  const root = consumer({ ".repo/settings/claude.json": "{" });
  const result = renderTrees(context(root, ["claude"]));
  expect(result).toStrictEqual({ errors: [expect.stringContaining(".repo/settings/claude.json")], ok: false });
  expect(stagesIn(root)).toStrictEqual([]);
});

it("reports a .repo/settings/claude.json that is not an object", () => {
  const root = consumer({ ".repo/settings/claude.json": "[]" });
  expect(renderTrees(context(root, ["claude"]))).toStrictEqual({
    errors: [expect.stringContaining("must be a JSON object")],
    ok: false,
  });
});

it("writes no .mcp.json, and reports one that is not valid JSON with nothing staged", () => {
  expect(find(render(consumer({ ".mcp.json": '{"mcpServers":{}}' }), HOSTS), ".mcp.json")).toBeUndefined();
  const root = consumer({ ".mcp.json": "{" });
  expect(renderTrees(context(root, ["claude"]))).toStrictEqual({
    errors: ["mcp policy: .mcp.json: not valid JSON at line 1; fix it, nothing written"],
    ok: false,
  });
  expect(stagesIn(root)).toStrictEqual([]);
});

it("reports an emit step that rejects the merged mcp policy", () => {
  const root = consumer({ ".repo/mcp-policy.jsonc": '{ "allow": 5 }' });
  expect(renderTrees(context(root, ["claude"]))).toStrictEqual({
    errors: ["mcp policy: allow must be an array"],
    ok: false,
  });
  expect(stagesIn(root)).toStrictEqual([]);
});

it("ignores .repo/settings/claude.json when claude is off", () => {
  const root = consumer({ ".repo/settings/claude.json": "{" });
  expect(renderTrees(context(root, ["codex"])).ok).toBe(true);
});

it("keeps a consumer scripts/ hook and a .repo/permissions.json deny in the hook files", () => {
  const root = consumer({
    ".repo/permissions.json": JSON.stringify({ deny: ["Edit(./vendor/**)"] }),
    "scripts/daily-pull-check.mjs": "// pull\n",
  });
  const outputs = render(root, ["claude", "codex"]);
  expect(text(outputs, SETTINGS)).toContain("daily-pull-check.mjs");
  expect(text(outputs, SETTINGS)).toContain("Edit(./vendor/**)");
  expect(text(outputs, ".codex/hooks.json")).toContain("daily-pull-check.mjs");
});

it("merges a .repo/mcp-policy.jsonc over the stock policy, its allow list picking servers of the own .mcp.json", () => {
  const root = consumer({
    ".mcp.json": JSON.stringify({ mcpServers: { mine: { command: "x" }, off: { command: "y" } } }),
    ".repo/mcp-policy.jsonc": '{ "allow": ["mine"] }',
  });
  const mcp = json<McpFile>(render(root, ["antigravity"]), ".agents/mcp_config.json");
  expect(mcp.mcpServers).toStrictEqual({ mine: { command: "x" } });
});
