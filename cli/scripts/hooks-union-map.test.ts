import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import {
  EDIT_PLATFORM,
  MCP_DENY,
  PARENT,
  REPO_ROOT,
  SCRUB,
  WRITE_PLATFORM,
  must,
  ownedPre,
  readJson,
  seedOwnedDrivers,
  shipStub,
  touchConsumerScripts,
  writeJson,
  type AgentsDoc,
  type ClaudeDoc,
  type GrokDoc,
} from "./fixtures/hooks-union-kit.ts";
import { plantDirs } from "./fixtures/mcp-policy-kit.ts";
import { hookCommand } from "./hook-command.ts";
import { MAP, rootCmd } from "./hooks-union-commands.ts";
import { AGY_WRITE_MATCHER, AUTORUN_NEEDLES, OWNED_HOOKS, POST_WRITE_MATCHER } from "./hooks-union.constants.ts";
import { applyUnion, checkUnion } from "./hooks-union.ts";

const tmpDir = plantDirs();

it("adds session-map SessionStart first on claude/codex (not agents/grok) and checks for it", () => {
  const ws = tmpDir("union-map-");
  seedOwnedDrivers(ws);
  touchConsumerScripts(ws);
  shipStub(ws, "session-map.ts");
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
  expect(must(claude.hooks.SessionStart?.[0]).hooks[0]).toStrictEqual({ command: MAP, timeout: 5, type: "command" });
  expect(JSON.stringify(claude.hooks.SessionStart)).toMatch(/daily-pull-check/);
  expect(JSON.stringify(readJson(ws, ".codex/hooks.json"))).toContain("hook session-map");
  const agents = readJson<AgentsDoc>(ws, ".agents/hooks.json");
  expect(JSON.stringify(agents)).not.toContain("session-map");
  expect(JSON.stringify(agents.rulesync.SessionStart)).toMatch(/daily-pull-check/);
  expect(readJson<GrokDoc>(ws, ".grok/hooks/orchestrate-parent.json").hooks.SessionStart).toBeUndefined();
  expect(checkUnion({ workspaceRoot: ws })).toStrictEqual([]);

  claude.hooks.SessionStart = [];
  writeJson(ws, ".claude/settings.json", claude);
  expect(checkUnion({ workspaceRoot: ws })).toContain("claude: missing session-map");
});

it("replaces an old-form map with the one repo hook command, and stays put", () => {
  const ws = tmpDir("union-map-old-");
  seedOwnedDrivers(ws);
  shipStub(ws, "session-map.ts");
  const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
  claude.hooks.SessionStart = [
    { hooks: [{ command: rootCmd("cli/scripts/session-map.ts"), timeout: 5, type: "command" }] },
  ];
  writeJson(ws, ".claude/settings.json", claude);
  expect(checkUnion({ workspaceRoot: ws })).toContain(
    "claude: session-map hook command is not the one bun repo sync writes for session-map: run bun repo sync",
  );
  expect(MAP).toBe(hookCommand("session-map"));
  applyUnion({ workspaceRoot: ws });
  const first = fs.readFileSync(path.join(ws, ".claude/settings.json"), "utf8");
  applyUnion({ workspaceRoot: ws });
  expect(fs.readFileSync(path.join(ws, ".claude/settings.json"), "utf8")).toBe(first);
  const session = must(readJson<ClaudeDoc>(ws, ".claude/settings.json").hooks.SessionStart);
  expect(session.flatMap((g) => g.hooks.map((h) => h.command))).toStrictEqual([MAP]);
  expect(checkUnion({ workspaceRoot: ws })).toStrictEqual([]);
});

/** A consumer repo whose hook files hold only rulesync's groups, a write-path deny and an overlay deny. */
function strippedConsumer(): string {
  const ws = tmpDir("union-consumer-");
  seedOwnedDrivers(ws);
  touchConsumerScripts(ws);
  writeJson(ws, ".repo/permissions.json", { deny: [EDIT_PLATFORM] });
  const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
  claude.hooks = { PreToolUse: ownedPre, UserPromptSubmit: claude.hooks.UserPromptSubmit };
  claude.permissions.deny = [...claude.permissions.deny, WRITE_PLATFORM];
  writeJson(ws, ".claude/settings.json", claude);
  writeJson(ws, ".codex/hooks.json", { hooks: { PreToolUse: ownedPre } });
  writeJson(ws, ".agents/hooks.json", { rulesync: { PreToolUse: ownedPre } });
  return ws;
}

function expectClaudeOverlay(ws: string): void {
  const next = readJson<ClaudeDoc>(ws, ".claude/settings.json");
  const text = JSON.stringify(next);
  for (const n of [...AUTORUN_NEEDLES, ...OWNED_HOOKS]) expect(text).toContain(n);
  expect(JSON.stringify(next.hooks.UserPromptSubmit)).toMatch(PARENT);
  expect(next.permissions.deny).toContain(MCP_DENY);
  expect(next.permissions.deny).toContain(EDIT_PLATFORM);
  expect(next.permissions.deny).not.toContain(WRITE_PLATFORM);
  expect(next.permissions.deny.some((x: string) => String(x).startsWith("Write("))).toBe(false);
  expect(next.hooks.SessionStart).toBeTruthy();
  expect(JSON.stringify(next.hooks.PreToolUse)).toMatch(/check-behind/);
  expect(JSON.stringify(next.hooks.PostToolUse)).toMatch(/validate\.mjs/);
  expect(JSON.stringify(next.hooks.PostToolUse)).toMatch(/sim\.mjs/);
  expect(must(next.hooks.PostToolUse?.[0]).matcher).toBe(POST_WRITE_MATCHER);
  expect(JSON.stringify(next.hooks.PostToolUse)).not.toContain('"matcher": ".*"');
}

function expectAgentsOverlay(ws: string): void {
  const agents = readJson<AgentsDoc>(ws, ".agents/hooks.json");
  expect(agents["validate-artifact"].matcher).toBe(AGY_WRITE_MATCHER);
  expect(agents["simulate-artifact"].matcher).toBe(AGY_WRITE_MATCHER);
  expect(must(agents.rulesync.PostToolUse[0]).matcher).toBe(AGY_WRITE_MATCHER);
  expect(JSON.stringify(agents.rulesync.PostToolUse)).not.toContain('"matcher": ".*"');
  expect(JSON.stringify(agents["validate-artifact"])).not.toContain('"matcher": ".*"');
  expect(JSON.stringify(agents["simulate-artifact"])).not.toContain('"matcher": ".*"');
  expect(JSON.stringify(agents.rulesync.Stop ?? agents.rulesync.stop)).toBeUndefined();
  expect(JSON.stringify(agents.rulesync.PreToolUse)).toMatch(SCRUB);
}

it("puts SessionStart / check-behind / validate+sim / overlay Edit deny back beside rulesync's scrub/gate", () => {
  const ws = strippedConsumer();
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  expect(checkUnion({ workspaceRoot: ws })).toStrictEqual([]);
  expectClaudeOverlay(ws);
  expectAgentsOverlay(ws);
  const ssot = fs.readFileSync(path.join(ws, "agents/hooks.jsonc"), "utf8");
  expect(ssot).toMatch(/"beforeSubmitPrompt"/);
});

it("apply is idempotent on keep-list", () => {
  const ws = tmpDir("union-idemp-");
  seedOwnedDrivers(ws);
  touchConsumerScripts(ws);
  writeJson(ws, ".repo/permissions.json", { deny: [EDIT_PLATFORM] });
  applyUnion({ workspaceRoot: ws });
  const first = fs.readFileSync(path.join(ws, ".claude/settings.json"), "utf8");
  applyUnion({ workspaceRoot: ws });
  const second = fs.readFileSync(path.join(ws, ".claude/settings.json"), "utf8");
  expect(second).toBe(first);
  const deny = readJson<ClaudeDoc>(ws, ".claude/settings.json").permissions.deny;
  expect(deny.filter((x: string) => x === MCP_DENY)).toStrictEqual([MCP_DENY]);
  expect(deny.filter((x: string) => x === EDIT_PLATFORM)).toStrictEqual([EDIT_PLATFORM]);
});

it("package SoT is beforeSubmitPrompt; Claude/Codex native UserPromptSubmit; check ok", () => {
  const ssot = fs.readFileSync(path.join(REPO_ROOT, "agents/hooks.jsonc"), "utf8");
  expect(ssot).toMatch(/"beforeSubmitPrompt"/);
  expect(ssot).not.toMatch(/"userPromptSubmit"/);
  const claude = readJson<ClaudeDoc>(REPO_ROOT, ".claude/settings.json");
  expect(claude.hooks.UserPromptSubmit).toBeDefined();
  expect(claude.hooks.beforeSubmitPrompt).toBeUndefined();
  expect(claude.permissions.deny).toContain(MCP_DENY);
  const codex = readJson<{ hooks: { UserPromptSubmit?: unknown } }>(REPO_ROOT, ".codex/hooks.json");
  expect(codex.hooks.UserPromptSubmit).toBeDefined();
  expect(checkUnion({ workspaceRoot: REPO_ROOT })).toStrictEqual([]);
});
