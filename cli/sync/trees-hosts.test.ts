import fs from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { RENDER_TIMEOUT, STOCK_SKILL, consumer, find, linkTarget, paths, render } from "./fixtures/trees-kit.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();
vi.setConfig({ testTimeout: RENDER_TIMEOUT });

it("claude alone writes AGENTS.md, .mcp.json and .claude, with skills linked straight to stock", () => {
  const outputs = render(consumer(), ["claude"]);
  const rest = paths(outputs).filter((rel) => rel !== ".vscode/tasks.json");
  expect(rest.filter((rel) => !rel.startsWith(".claude/")).sort()).toEqual(["AGENTS.md", ".mcp.json"].sort());
  expect(linkTarget(outputs, ".claude/skills/ask")).toBe(`${STOCK_SKILL}/ask`);
  expect(find(outputs, ".claude/skills/ask")?.tracked).toBe(false);
  expect(find(outputs, ".claude/skills/listen")).toBeUndefined();
});

it("codex alone links .agents/skills and writes no .agents/agents", () => {
  const outputs = render(consumer(), ["codex"]);
  expect(linkTarget(outputs, ".agents/skills/ask")).toBe(`${STOCK_SKILL}/ask`);
  expect(paths(outputs).filter((rel) => rel.startsWith(".agents/") && !rel.startsWith(".agents/skills/"))).toEqual([]);
  expect(paths(outputs).some((rel) => rel.startsWith(".claude/"))).toBe(false);
  expect(find(outputs, ".mcp.json")).toBeUndefined();
  expect(find(outputs, ".codex/config.toml")?.kind).toBe("file");
  expect(find(outputs, ".agents/mcp_config.json")).toBeUndefined();
});

it("antigravity alone writes .agents, and claude links through it when both are on", () => {
  const agy = render(consumer(), ["antigravity"]);
  expect(find(agy, ".agents/agents/scout.md")?.kind).toBe("file");
  expect(linkTarget(agy, ".agents/skills/ask")).toBe(`${STOCK_SKILL}/ask`);
  const both = render(consumer(), ["claude", "antigravity"]);
  expect(linkTarget(both, ".claude/skills/ask")).toBe("../../.agents/skills/ask");
});

it("grok and cursor alone write only their dirs and AGENTS.md", () => {
  const outputs = render(consumer(), ["grok", "cursor"]);
  const top = new Set(paths(outputs).map((rel) => rel.split("/")[0]));
  expect([...top].sort()).toEqual([".cursor", ".grok", ".vscode", "AGENTS.md"].sort());
});

it("no hosts writes nothing and runs nothing", () => {
  const root = consumer();
  expect(render(root, [])).toEqual([]);
  expect(fs.existsSync(path.join(root, ".repo"))).toBe(false);
});
