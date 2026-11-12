import { expect, it, vi } from "vitest";

import { HOSTS } from "../config.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";
import {
  RENDER_TIMEOUT,
  consumer,
  find,
  json,
  paths,
  render,
  stagesIn,
  text,
  type McpFile,
  type TasksFile,
} from "./__fixtures__/trees-kit.ts";
import { byCodeUnit } from "./by-code-unit.ts";

useTempDirs();

vi.setConfig({ testTimeout: RENDER_TIMEOUT });

// One render with every host on, shared by the tests below.
const root = consumer({
  ".vscode/tasks.json": JSON.stringify({
    tasks: [{ command: "make all", dependsOn: ["x"], label: "mine", type: "shell" }],
    version: "2.0.0",
  }),
});

const outputs = render(root, HOSTS);

it("writes every host tree untracked and AGENTS.md as a tracked shared file", () => {
  const top = new Set(paths(outputs).map((rel) => (rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : rel)));
  expect([...top].toSorted(byCodeUnit)).toStrictEqual(
    [".agents", ".claude", ".codex", ".cursor", ".grok", ".vscode", "AGENTS.md"].toSorted(byCodeUnit),
  );
  const tracked = new Set([".vscode/tasks.json", "AGENTS.md"]);

  for (const output of outputs.filter((o) => !tracked.has(o.path))) expect(output.tracked).toBe(false);
  expect(find(outputs, "AGENTS.md")).toMatchObject({ managed: "block", tracked: true });
  expect(text(outputs, "AGENTS.md")).toMatch(/^<!-- repo:rules [\da-f]{8} -->\n[\s\S]*<!-- \/repo:rules -->\n$/);
});

it("generates the committed-shape files the generators and the emit steps own", () => {
  for (const rel of [
    ".claude/settings.json",
    ".claude/agents/scout.md",
    ".codex/config.toml",
    ".codex/hooks.json",
    ".agents/hooks.json",
    ".agents/agents/scout.md",
    ".cursor/hooks.json",
    ".grok/config.toml",
    ".grok/agents/scout.md",
  ])
    expect(find(outputs, rel)?.kind, rel).toBe("file");

  expect(json<McpFile>(outputs, ".agents/mcp_config.json")).toStrictEqual({ mcpServers: {} });
  expect(text(outputs, ".claude/settings.json")).toContain("repo");
});

it("copies the static grok files and never a .grok/hooks script", () => {
  expect(find(outputs, ".grok/roles/scout.toml")?.kind).toBe("file");
  expect(find(outputs, ".grok/hooks/rulesync.json")?.kind).toBe("file");
  expect(find(outputs, ".grok/hooks/orchestrate-parent.json")?.kind).toBe("file");
  expect(paths(outputs).filter((rel) => rel.startsWith(".grok/hooks/") && /\.(ts|tsx)$/.test(rel))).toStrictEqual([]);
  expect(find(outputs, ".grok/hooks/package.json")).toBeUndefined();
});

it("keeps a consumer's own task in the tracked .vscode/tasks.json", () => {
  const tasks = json<TasksFile>(outputs, ".vscode/tasks.json");
  expect(find(outputs, ".vscode/tasks.json")?.tracked).toBe(true);
  expect(tasks.tasks.map((task) => task.label)).toStrictEqual(["build", "mine"]);
});

it("removes the stage dir", () => {
  expect(stagesIn(root)).toStrictEqual([]);
});
