import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { removeTemps } from "../__fixtures__/remove-temps.ts";
import { plantFile } from "./__fixtures__/plant-file.ts";
import {
  changeLine,
  parseSettingWords,
  readSessionSettings,
  settingsPath,
  writeSessionSettings,
} from "./session-settings.ts";

const temps: string[] = [];

afterEach(() => {
  removeTemps(temps.splice(0));
});

function temp(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "session-settings-")));
  temps.push(dir);

  return dir;
}

const ALL = "ask, away, fast, deep, free, spawn-fast or spawn-deep";

it("reads any subset of the seven words, in any order", () => {
  expect(parseSettingWords(["away"])).toStrictEqual({ ok: true, value: { approval: "away" } });
  expect(parseSettingWords(["spawn-fast", "away"])).toStrictEqual({
    ok: true,
    value: { approval: "away", strategy: "spawn-fast" },
  });
  expect(parseSettingWords(["deep", "spawn-deep", "ask"])).toStrictEqual({
    ok: true,
    value: { approval: "ask", effort: "deep", strategy: "spawn-deep" },
  });
  expect(parseSettingWords(["free"])).toStrictEqual({ ok: true, value: { strategy: "free" } });
  expect(parseSettingWords(["fast"])).toStrictEqual({ ok: true, value: { effort: "fast" } });
});

it("names the first word that is not a setting", () => {
  expect(parseSettingWords(["away", "fsat"])).toStrictEqual({
    error: `set: "fsat" is not a setting; use ${ALL}`,
    ok: false,
  });
});

it("refuses two words for one setting", () => {
  expect(parseSettingWords(["fast", "deep"])).toStrictEqual({
    error: "set: fast and deep both set effort; pick one",
    ok: false,
  });
  expect(parseSettingWords(["away", "ask"]).ok).toBe(false);
  expect(parseSettingWords(["free", "spawn-deep"]).ok).toBe(false);
});

it("refuses no words", () => {
  expect(parseSettingWords([])).toStrictEqual({ error: `set: name a setting: ${ALL}`, ok: false });
});

it("lives under the session's dir in the resolved root", () => {
  expect(settingsPath("/r", "s1")).toBe(path.join("/r", ".repo/tmp/sessions", "s1", "settings.json"));
});

it("reads back what was written, and a later write keeps the other values", () => {
  const root = temp();
  expect(readSessionSettings(root, "s1")).toStrictEqual({});
  writeSessionSettings(root, "s1", { approval: "away" });
  writeSessionSettings(root, "s1", { effort: "fast" });
  writeSessionSettings(root, "s1", { strategy: "spawn-fast" });
  expect(readSessionSettings(root, "s1")).toStrictEqual({ approval: "away", effort: "fast", strategy: "spawn-fast" });
  writeSessionSettings(root, "s1", { approval: "ask" });
  expect(readSessionSettings(root, "s1")).toStrictEqual({ approval: "ask", effort: "fast", strategy: "spawn-fast" });
});

it("keeps each session's settings apart and leaves no temp file beside the file", () => {
  const root = temp();
  writeSessionSettings(root, "a", { approval: "away" });
  writeSessionSettings(root, "b", { effort: "fast" });
  expect(readSessionSettings(root, "a")).toStrictEqual({ approval: "away" });
  expect(readSessionSettings(root, "b")).toStrictEqual({ effort: "fast" });
  expect(fs.readdirSync(path.dirname(settingsPath(root, "a")))).toStrictEqual(["settings.json"]);
});

it.each([
  ["not JSON", "{nope"],
  ["an array", "[1]"],
  ["a string", '"away"'],
  ["empty", ""],
])("reads %s as no settings", (_name, text) => {
  const root = temp();
  plantFile(root, ".repo/tmp/sessions/s1/settings.json", text);
  expect(readSessionSettings(root, "s1")).toStrictEqual({});
});

it("reads a directory where the file should be as no settings", () => {
  const root = temp();
  fs.mkdirSync(settingsPath(root, "s1"), { recursive: true });
  expect(readSessionSettings(root, "s1")).toStrictEqual({});
});

it("drops a value that is not one of the setting's values", () => {
  const root = temp();
  plantFile(root, ".repo/tmp/sessions/s1/settings.json", '{"approval": "auto", "effort": "fast", "strategy": 3}');
  expect(readSessionSettings(root, "s1")).toStrictEqual({ effort: "fast" });
});

const before = { approval: "ask", effort: "deep", strategy: "free" } as const;

it("names each setting that changed with the value it had", () => {
  expect(changeLine(before, { approval: "away" })).toBe("set approval away (was ask)");
  expect(changeLine(before, { approval: "away", strategy: "spawn-fast" })).toBe(
    "set approval away (was ask), strategy spawn-fast (was free)",
  );
});

it("leaves out a named setting that already holds its value", () => {
  expect(changeLine(before, { approval: "away", effort: "deep" })).toBe("set approval away (was ask)");
});

it("says no change when every named setting already holds its value", () => {
  expect(changeLine({ ...before, approval: "away" }, { approval: "away" })).toBe(
    "set: no change; approval is already away",
  );
});
