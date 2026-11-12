import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import {
  must,
  ownedPre,
  readJson,
  seedOwnedDrivers,
  touchConsumerScripts,
  writeJson,
  type AgentsDoc,
  type ClaudeDoc,
  type HookGroup,
} from "./__fixtures__/hooks-union-kit.ts";
import { plantDirs } from "./__fixtures__/mcp-policy-kit.ts";
import { MAP } from "./hooks-union-commands.ts";
import { AGY_WRITE_MATCHER, AUTORUN_NEEDLES, OWNED_HOOKS } from "./hooks-union.constants.ts";
import { applyUnion } from "./hooks-union.ts";

const tmpDir = plantDirs();
const AGY_SCRUB_GATE = [ownedPre[0], { ...ownedPre[1], matcher: "read_file|run_command|write_file|edit_file" }];

/** A repo with rulesync's hook files and every consumer autorun script. */
function consumerRepo(prefix: string): string {
  const ws = tmpDir(prefix);
  seedOwnedDrivers(ws);
  touchConsumerScripts(ws);

  return ws;
}

/** The groups of `pre` that hold a scrub or gate hook. */
function ownedGroups(pre: { hooks: { command: string }[] }[]) {
  return pre.filter((g) => g.hooks.some((h) => OWNED_HOOKS.some((n) => h.command.includes(n))));
}

function behindGroup(pre: HookGroup[]) {
  return must(pre.find((g) => g.hooks.some((h) => h.command.includes("check-behind.mjs"))));
}

it("leaves the scrub and gate PreToolUse groups of every hook file byte-equal", () => {
  const ws = consumerRepo("union-owned-");
  writeJson(ws, ".agents/hooks.json", { rulesync: { PreToolUse: AGY_SCRUB_GATE } });
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  expect(ownedGroups(readJson<ClaudeDoc>(ws, ".claude/settings.json").hooks.PreToolUse)).toStrictEqual(ownedPre);
  expect(ownedGroups(readJson<ClaudeDoc>(ws, ".codex/hooks.json").hooks.PreToolUse)).toStrictEqual(ownedPre);
  expect(ownedGroups(readJson<AgentsDoc>(ws, ".agents/hooks.json").rulesync.PreToolUse)).toStrictEqual(AGY_SCRUB_GATE);
});

it("writes no top-level scrub or gate entry into .agents/hooks.json", () => {
  const ws = consumerRepo("union-named-");
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  const keys = Object.keys(readJson<AgentsDoc>(ws, ".agents/hooks.json"));
  expect(keys).toStrictEqual(expect.arrayContaining(["daily-pull-all", "check-behind", "validate-artifact"]));
  expect(keys).not.toContain("scrub-spawn-prompt");
  expect(keys).not.toContain("gate-fat-tools");
});

it("appends flat SessionStart entries after rulesync's, the session map first", () => {
  const ws = consumerRepo("union-agy-session-");
  const mapEntry = { command: MAP, timeout: 5, type: "command" };
  const agents = readJson<AgentsDoc>(ws, ".agents/hooks.json");
  agents.rulesync.SessionStart = [mapEntry];
  writeJson(ws, ".agents/hooks.json", agents);
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  const session = readJson<AgentsDoc>(ws, ".agents/hooks.json").rulesync.SessionStart;
  expect(session[0]).toStrictEqual(mapEntry);
  expect(session.map((e: { command: string }) => AUTORUN_NEEDLES.find((n) => e.command.includes(n)))).toStrictEqual([
    undefined,
    "daily-pull-check.mjs",
    "rtk-check.mjs",
    "daily-fleet-check.mjs",
  ]);

  for (const e of session) {
    const keys = e.timeout === undefined ? ["command", "type"] : ["command", "timeout", "type"];
    expect(Object.keys(e).toSorted()).toStrictEqual(keys);
  }

  const first = fs.readFileSync(path.join(ws, ".agents/hooks.json"), "utf8");
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  expect(fs.readFileSync(path.join(ws, ".agents/hooks.json"), "utf8")).toBe(first);
});

it("writes SessionStart without a map entry when rulesync wrote none", () => {
  const ws = consumerRepo("union-agy-nomap-");
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  const session = readJson<AgentsDoc>(ws, ".agents/hooks.json").rulesync.SessionStart;
  expect(session).toHaveLength(3);
  expect(JSON.stringify(session)).not.toContain("session-map");
});

it("matches writes by Antigravity tool names, not Claude's", () => {
  const ws = consumerRepo("union-agy-names-");
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  const agents = readJson<AgentsDoc>(ws, ".agents/hooks.json");
  expect(AGY_WRITE_MATCHER).toBe("write_file|edit_file");
  expect(behindGroup(agents.rulesync.PreToolUse).matcher).toBe(AGY_WRITE_MATCHER);
  expect(agents["check-behind"].matcher).toBe(AGY_WRITE_MATCHER);
  expect(must(agents.rulesync.PostToolUse[0]).matcher).toBe(AGY_WRITE_MATCHER);

  for (const k of ["validate-artifact", "simulate-artifact"] as const)
    expect(agents[k].matcher).toBe(AGY_WRITE_MATCHER);
  const claudePre = readJson<ClaudeDoc>(ws, ".claude/settings.json").hooks.PreToolUse;
  expect(behindGroup(claudePre).matcher).toBe("Write|Edit");
});
