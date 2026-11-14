import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { removeTree } from "../remove-tree.ts";
import {
  ownedFlat,
  readJson,
  seedOwnedDrivers,
  touchConsumerScripts,
  writeJson,
  type CursorDoc,
  type FlatEntry,
} from "./__fixtures__/hooks-union-kit.ts";
import { plantDirs } from "./__fixtures__/mcp-policy-kit.ts";
import { MAP, rootCmd } from "./hooks-union-commands.ts";
import { AUTORUN_NEEDLES, CURSOR_WRITE_MATCHER, OWNED_HOOKS } from "./hooks-union.constants.ts";
import { applyUnion, checkUnion } from "./hooks-union.ts";

const tmpDir = plantDirs();

function cursorHooks(ws: string) {
  return readJson<CursorDoc>(ws, ".cursor/hooks.json");
}

function scriptOf(e: FlatEntry) {
  return AUTORUN_NEEDLES.find((n) => e.command.includes(n));
}

/** A repo with rulesync's hook files and every consumer autorun script. */
function consumerRepo(prefix: string): string {
  const ws = tmpDir(prefix);
  seedOwnedDrivers(ws);
  touchConsumerScripts(ws);

  return ws;
}

function expectCursorExtras({ version, hooks }: CursorDoc, mapEntry: FlatEntry): void {
  expect(version).toBe(1);
  expect(hooks.sessionStart[0]).toStrictEqual(mapEntry);
  expect(hooks.sessionStart.map(scriptOf)).toStrictEqual([
    undefined,
    "daily-pull-check.mjs",
    "rtk-check.mjs",
    "daily-fleet-check.mjs",
  ]);
  const behind = hooks.preToolUse.filter((e) => e.command.includes("check-behind.mjs"));
  expect(behind).toStrictEqual([
    { command: rootCmd("scripts/check-behind.mjs", "--hook"), matcher: CURSOR_WRITE_MATCHER, type: "command" },
  ]);
  expect(hooks.postToolUse.map(scriptOf)).toStrictEqual(["validate.mjs", "sim.mjs"]);
  expect(hooks.postToolUse.map((e) => e.matcher)).toStrictEqual([CURSOR_WRITE_MATCHER, CURSOR_WRITE_MATCHER]);

  for (const e of [...hooks.sessionStart, ...hooks.preToolUse, ...hooks.postToolUse]) expect(e.hooks).toBeUndefined();
  expect(hooks.preToolUse.filter((e) => OWNED_HOOKS.some((n) => e.command.includes(n)))).toStrictEqual(ownedFlat);
}

it("appends flat entries under sessionStart, preToolUse and postToolUse, rulesync's kept as written", () => {
  const ws = consumerRepo("union-cursor-");
  const mapEntry = { command: MAP, timeout: 5, type: "command" };
  const seeded = cursorHooks(ws);
  seeded.hooks.sessionStart = [mapEntry];
  writeJson(ws, ".cursor/hooks.json", seeded);
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  const next = cursorHooks(ws);
  expectCursorExtras(next, mapEntry);
  expect(next.hooks.stop).toStrictEqual(seeded.hooks.stop);
  expect(checkUnion({ workspaceRoot: ws })).toStrictEqual([]);
  expect(checkUnion({ consumerRoot: "", sourceRoot: "", workspaceRoot: ws })).toStrictEqual([]);
  const first = fs.readFileSync(path.join(ws, ".cursor/hooks.json"), "utf8");
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  expect(fs.readFileSync(path.join(ws, ".cursor/hooks.json"), "utf8")).toBe(first);
});

it("leaves a repo with no autorun scripts as rulesync wrote it", () => {
  const ws = tmpDir("union-cursor-plain-");
  seedOwnedDrivers(ws);
  const before = cursorHooks(ws);
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  expect(cursorHooks(ws)).toStrictEqual(before);
  expect(checkUnion({ workspaceRoot: ws })).toStrictEqual([]);
});

it("writes the file when rulesync wrote none", () => {
  const ws = consumerRepo("union-cursor-new-");
  removeTree(path.join(ws, ".cursor"));
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  expect(cursorHooks(ws).version).toBe(1);
  expect(cursorHooks(ws).hooks.sessionStart.map(scriptOf)).toStrictEqual([
    "daily-pull-check.mjs",
    "rtk-check.mjs",
    "daily-fleet-check.mjs",
  ]);
});

it("--check reports cursor: missing for a file or a script it lacks", () => {
  const ws = consumerRepo("union-cursor-check-");
  applyUnion({ workspaceRoot: ws });
  const live = cursorHooks(ws);
  live.hooks.sessionStart = live.hooks.sessionStart.filter((e) => !e.command.includes("daily-pull-check.mjs"));
  writeJson(ws, ".cursor/hooks.json", live);
  expect(checkUnion({ workspaceRoot: ws })).toStrictEqual(["cursor: missing daily-pull-check.mjs"]);
  live.hooks.preToolUse = [];
  writeJson(ws, ".cursor/hooks.json", live);
  expect(checkUnion({ workspaceRoot: ws })).toStrictEqual(
    expect.arrayContaining(OWNED_HOOKS.map((n) => `cursor: missing ${n}`)),
  );
  fs.rmSync(path.join(ws, ".cursor/hooks.json"));
  expect(checkUnion({ workspaceRoot: ws })).toContain("cursor: missing .cursor/hooks.json");
});

it("--check names a cursor command that does not find its script from the repo root", () => {
  const ws = consumerRepo("union-cursor-stale-");
  applyUnion({ workspaceRoot: ws });
  const live = cursorHooks(ws);
  live.hooks.postToolUse.push({ command: "node scripts/validate.mjs --hook", matcher: "Write", type: "command" });
  writeJson(ws, ".cursor/hooks.json", live);
  expect(checkUnion({ workspaceRoot: ws })).toContain(
    "cursor: validate.mjs hook command does not find its script from the repo root: run bun repo sync",
  );
});
