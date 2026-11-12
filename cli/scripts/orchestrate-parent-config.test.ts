import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";
import { z } from "zod";

import { readJson } from "../json.ts";
import { loadSources } from "../sync/agents/load-sources.ts";
import { renderHooks } from "../sync/agents/render-hooks.ts";
import { orchestrateKit, parseJson, replyOf } from "./__fixtures__/orchestrate-kit.ts";
import { isUnderTmp, TMP_RESERVED_DIRS } from "./persist-tmp.ts";

const kit = orchestrateKit();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function repoText(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

/** A generated hooks file as far as the test reads it: its table of hooks. */
function hooksFile() {
  return z.object({ hooks: z.record(z.string(), z.json()) });
}

type Hooks = { hooks?: { SessionStart?: unknown; SubagentStop?: unknown } };

it("spawn and read allow without a top-level decision", () => {
  const ws = kit.temp();
  const file = path.join(ws, "small.txt");
  fs.writeFileSync(file, "abc");
  const spawnInput = { prompt: "You are scout subagent. ship it", resume_from: "child-1", subagent_type: "scout" };
  const spawn = kit.grok({ ws }, "PreToolUse", { toolInput: spawnInput, toolName: "spawn_subagent" });
  expect(replyOf(spawn)?.decision).toBeUndefined();
  const read = kit.grok({ ws }, "PreToolUse", { toolInput: { target_file: file }, toolName: "read_file" });
  // Allow is empty stdout; a fat rewrite emits hookSpecificOutput only.
  expect(replyOf(read)?.decision).toBeUndefined();
});

it("orchestrate-parent.json still has no SessionStart", () => {
  const json = parseJson<Hooks>(repoText(".grok/hooks/orchestrate-parent.json"));
  expect(json.hooks?.SessionStart).toBeUndefined();
  expect(JSON.stringify(json)).not.toMatch(/SessionStart/);
});

it("claude settings do not deny Agent(orchestrator); hooks.jsonc has Stop + UserPromptSubmit", () => {
  const settings = parseJson<{ permissions: { deny: string[] } } & Hooks>(repoText(".claude/settings.json"));
  expect(settings.permissions.deny).not.toContain("Agent(orchestrator)");
  const ssot = fs.readFileSync(path.join(root, "agents/hooks.jsonc"), "utf8");
  expect(ssot).toMatch(/"stop"/);
  expect(ssot).toMatch(/"beforeSubmitPrompt"/);
  expect(ssot).not.toMatch(/"userPromptSubmit"/);
  expect(ssot).toMatch(/hook orchestrate-parent/);

  const jsonc = parseJson<{ hooks: Record<string, { command: string; timeout: number }[] | undefined> }>(
    ssot.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/.*$/gm, ""),
  );

  expect(Object.keys(jsonc.hooks)).toStrictEqual(expect.arrayContaining(["preToolUse", "beforeSubmitPrompt", "stop"]));
  expect(Object.keys(jsonc.hooks)).not.toContain("userPromptSubmit");
  expect(jsonc.hooks.beforeSubmitPrompt?.[0]?.command).toMatch(/hook orchestrate-parent/);
  expect(jsonc.hooks.beforeSubmitPrompt?.[0]?.timeout).toBe(5);
  expect(JSON.stringify(settings.hooks?.SubagentStop)).toMatch(/hook orchestrate-parent/);
  const grokJson = parseJson<Hooks>(repoText(".grok/hooks/orchestrate-parent.json"));
  expect(JSON.stringify(grokJson.hooks?.SubagentStop)).toMatch(/hook orchestrate-parent/);
});

it("generated hooks map canonical beforeSubmitPrompt and stop", () => {
  const files = renderHooks(
    loadSources({ consumerRoot: null, packages: [], stockRoot: root }).sources,
    ["claude", "codex", "antigravity"],
    fs.readFileSync(path.join(root, "agents/settings/claude.json"), "utf8"),
  );

  function text(rel: string) {
    return files.get(rel) ?? "";
  }

  const claude = readJson(hooksFile(), text(".claude/settings.json")).hooks;
  expect(JSON.stringify(claude.PreToolUse)).toMatch(/scrub-spawn-prompt/);
  expect(JSON.stringify(claude.PreToolUse)).toMatch(/gate-fat-tools/);
  expect(JSON.stringify(claude.UserPromptSubmit)).toMatch(/hook orchestrate-parent/);
  expect(JSON.stringify(claude.Stop ?? claude.stop)).toMatch(/hook orchestrate-parent/);
  const codex = readJson(hooksFile(), text(".codex/hooks.json")).hooks;
  expect(JSON.stringify(codex.PreToolUse)).toMatch(/scrub-spawn-prompt/);
  expect(JSON.stringify(codex.UserPromptSubmit)).toMatch(/hook orchestrate-parent/);
  expect(JSON.stringify(codex.Stop ?? codex.stop)).toMatch(/hook orchestrate-parent/);
  const ag = readJson(z.object({ rulesync: z.record(z.string(), z.json()) }), text(".agents/hooks.json")).rulesync;
  expect(JSON.stringify(ag.PreToolUse)).toMatch(/scrub-spawn-prompt/);
  expect(JSON.stringify(ag.PreToolUse)).toMatch(/gate-fat-tools/);
  expect([ag.UserPromptSubmit, ag.beforeSubmitPrompt, ag.userPromptSubmit]).toStrictEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect(JSON.stringify(ag.Stop ?? ag.stop)).toMatch(/hook orchestrate-parent/);
  expect(fs.existsSync(path.join(root, "cli/scripts/orchestrate-parent.ts"))).toBe(true);
  expect(fs.existsSync(path.join(root, ".grok/hooks/orchestrate-parent.json"))).toBe(true);
});

it("isUnderTmp matches root files and rejects reserved and nested paths", () => {
  const ws = "/ws";
  const reserved = ["plans", "roadmaps", "handoffs", "implementations", "browser", "orchestrator-logs", "stash"];
  expect(TMP_RESERVED_DIRS).toStrictEqual(new Set([...reserved, "sessions", "listen", "speak"]));
  expect(isUnderTmp(".tmp/repo/notes.md", ws)).toBe(true);
  expect(isUnderTmp(path.join(ws, ".tmp/repo/1-x-20260827T143000Z.md"), ws)).toBe(true);

  for (const rel of ["tmp/x.md", "browser/x.md", "orchestrator-logs/x.md", "cov/x.md", "plans/x.md", "handoffs/x.md"])
    expect(isUnderTmp(`.tmp/repo/${rel}`, ws), rel).toBe(false);

  for (const rel of ["implementations/x.md", "plans", "handoffs", "implementations", "browser", "orchestrator-logs"])
    expect(isUnderTmp(`.tmp/repo/${rel}`, ws), rel).toBe(false);
});
