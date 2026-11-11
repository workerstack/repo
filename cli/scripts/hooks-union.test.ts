import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import {
  EDIT_PLATFORM,
  MCP_DENY,
  PARENT,
  SCRUB,
  WRITE_PLATFORM,
  ownedPre,
  readJson,
  seedOwnedDrivers,
  touchConsumerScripts,
  writeJson,
  type ClaudeDoc,
  type GrokDoc,
} from "./fixtures/hooks-union-kit.ts";
import { plantDirs } from "./fixtures/mcp-policy-kit.ts";
import { hookCommand } from "./hook-command.ts";
import { BEHIND, rootCmd } from "./hooks-union-commands.ts";
import { OWNED_HOOKS } from "./hooks-union.constants.ts";
import { applyUnion, checkUnion } from "./hooks-union.ts";

const tmpDir = plantDirs();

it("rootCmd runs the script with bun from the resolved project dir", () => {
  expect(rootCmd("a/x.mjs")).toMatch(/; bun "\$d\/a\/x\.mjs"$/);
  expect(rootCmd("a/x.mjs", "--hook")).toMatch(/; bun "\$d\/a\/x\.mjs" --hook$/);
});

/** The PreToolUse commands after a union over a repo whose Claude file also holds `command` and three own extras. */
function preCommandsAfter(command: string): string[] {
  const ws = tmpDir("union-ext-");
  seedOwnedDrivers(ws);
  touchConsumerScripts(ws);
  const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
  claude.hooks.PreToolUse.push(
    { hooks: [{ command, type: "command" }], matcher: "Write|Edit" },
    ...["mine.ts", "mine.mjs", "mine.js"].map((f) => ({
      hooks: [{ command: `bun scripts/${f}`, type: "command" }],
      matcher: "Bash",
    })),
  );
  writeJson(ws, ".claude/settings.json", claude);
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  return readJson<ClaudeDoc>(ws, ".claude/settings.json").hooks.PreToolUse.flatMap((g) =>
    g.hooks.map((h) => h.command),
  );
}

it("replaces a consumer hook by its script name under / or \\ separators and keeps other .ts/.mjs/.js extras", () => {
  for (const command of ['bun "C:\\r\\scripts\\check-behind.mjs" --hook', "bun /r/scripts/check-behind.mjs --old"]) {
    const commands = preCommandsAfter(command);
    expect(commands.filter((c) => c.includes("check-behind"))).toStrictEqual([BEHIND]);
    for (const kept of ["mine.ts", "mine.mjs", "mine.js"]) expect(commands).toContain(`bun scripts/${kept}`);
  }
});

/** The failures `--check` gives a Grok rtk hook file holding `command` that mention `needle`. */
function checkGrok(command: string, needle: string): string[] {
  const ws = tmpDir("union-form-");
  writeJson(ws, ".grok/hooks/rtk.json", { hooks: { PreToolUse: [{ hooks: [{ command, type: "command" }] }] } });
  return checkUnion({ workspaceRoot: ws }).filter((f) => f.includes(needle));
}

it("--check accepts hookCommand for a repo hook and rejects every other form", () => {
  expect(checkGrok(hookCommand("rtk-grok"), "rtk-grok")).toStrictEqual([]);
  for (const bad of [
    rootCmd("cli/scripts/rtk-grok.ts"),
    'bun "$GROK_WORKSPACE_ROOT/cli/scripts/rtk-grok.ts"',
    "bun cli/scripts/rtk-grok.ts",
    'bun ".grok\\hooks\\rtk-grok.ts"',
    "repo hook rtk-grok",
    hookCommand("rtk-grok").replace('"$r" hook', "bun repo hook"),
  ]) {
    expect(checkGrok(bad, "rtk-grok"), bad).toStrictEqual([
      "grok: rtk-grok hook command is not the one bun repo sync writes for rtk-grok: run bun repo sync",
    ]);
  }
});

it("--check accepts rootCmd for a consumer script and rejects every other form", () => {
  expect(checkGrok(rootCmd("scripts/validate.mjs", "--hook"), "validate.mjs")).toStrictEqual([]);
  expect(checkGrok("bun scripts/validate.mjs --hook", "validate.mjs")).toHaveLength(1);
});

it("keeps rulesync's scrub/gate groups, UPS/Stop and the mcp deny", () => {
  const ws = tmpDir("union-repo-");
  seedOwnedDrivers(ws);
  const r = applyUnion({ workspaceRoot: ws });
  expect(r.ok).toBe(true);
  const next = readJson<ClaudeDoc>(ws, ".claude/settings.json");
  const text = JSON.stringify(next);
  for (const n of OWNED_HOOKS) expect(text).toContain(`hook ${n}`);
  expect(next.hooks.PreToolUse).toStrictEqual(ownedPre);
  expect(JSON.stringify(next.hooks.UserPromptSubmit)).toMatch(PARENT);
  expect(JSON.stringify(next.hooks.Stop)).toMatch(PARENT);
  expect(next.permissions.deny).toContain(MCP_DENY);
  expect(next.permissions.deny).not.toContain(EDIT_PLATFORM);
  expect(next.permissions.deny).not.toContain(WRITE_PLATFORM);
  expect(next.hooks.SessionStart).toBeUndefined();
  expect(checkUnion({ workspaceRoot: ws })).toStrictEqual([]);
});

it("does not rewrite SoT beforeSubmitPrompt or grok SessionStart", () => {
  const ws = tmpDir("union-sot-");
  seedOwnedDrivers(ws);
  applyUnion({ workspaceRoot: ws });
  const ssot = fs.readFileSync(path.join(ws, "agents/hooks.jsonc"), "utf8");
  expect(ssot).toMatch(/"beforeSubmitPrompt"/);
  expect(ssot).not.toMatch(/"userPromptSubmit"/);
  expect(ssot).not.toMatch(/daily-pull-check/);
  const grok = readJson<GrokDoc>(ws, ".grok/hooks/orchestrate-parent.json");
  expect(grok.hooks.SessionStart).toBeUndefined();
  const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
  expect(claude.hooks.UserPromptSubmit).toBeDefined();
  expect(claude.hooks.beforeSubmitPrompt).toBeUndefined();
});

it("--check fails when repo needles missing; writes nothing", () => {
  const ws = tmpDir("union-check-");
  seedOwnedDrivers(ws);
  const claudePath = path.join(ws, ".claude/settings.json");
  const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
  claude.hooks.PreToolUse = [];
  fs.writeFileSync(claudePath, `${JSON.stringify(claude, null, 2)}\n`);
  const failures = checkUnion({ workspaceRoot: ws });
  expect(failures.some((f: string) => f.includes(SCRUB))).toBe(true);
  expect(applyUnion({ check: true, workspaceRoot: ws }).ok).toBe(false);
  expect(fs.readFileSync(claudePath, "utf8")).toContain('"PreToolUse": []');
});

it("platform/ dir without permissions.json emits no path deny", () => {
  const ws = tmpDir("union-plat-");
  seedOwnedDrivers(ws);
  fs.mkdirSync(path.join(ws, "platform"), { recursive: true });
  const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
  claude.permissions.deny = [...claude.permissions.deny, WRITE_PLATFORM];
  writeJson(ws, ".claude/settings.json", claude);
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  const deny = readJson<ClaudeDoc>(ws, ".claude/settings.json").permissions.deny;
  expect(deny).toContain(MCP_DENY);
  expect(deny).not.toContain(EDIT_PLATFORM);
  expect(deny).not.toContain(WRITE_PLATFORM);
  expect(deny.some((x: string) => x.startsWith("Write("))).toBe(false);
  expect(checkUnion({ workspaceRoot: ws })).toStrictEqual([]);
});
