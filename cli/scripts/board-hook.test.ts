import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { otherLines, probeProcess, readBootId, recordHook } from "./board.ts";
import type { BoardInput } from "./board.ts";
import { BOOT, plantHome, probeOf, rowsDir } from "./fixtures/board-kit.ts";

afterEach(() => vi.restoreAllMocks());

const probe = probeOf({ 30: {} });
const deps = { identity: { pid: 30, start: "100" }, boot: BOOT, probe, now: "T1" };
const record = (data: BoardInput | null, env: Record<string, string> = {}, extra = {}) =>
  recordHook(data, { REPO_BOARD_HOME: plantHome(), ...env }, { ...deps, ...extra });

it("recordHook provider: names the harness from the environment, then the payload", () => {
  const s = { session_id: "s" };
  expect(record(s, { REPO_BOARD_PROVIDER: "custom", CLAUDE_PROJECT_DIR: "/p" })?.provider).toBe("custom");
  expect(record(s, { GROK_WORKSPACE_ROOT: "/g" })?.provider).toBe("grok");
  expect(record(s, { GROK_HOOK_EVENT: "e" })?.provider).toBe("grok");
  expect(record({}, { GROK_SESSION_ID: "gs" })?.provider).toBe("grok");
  expect(record(s, { CLAUDE_PROJECT_DIR: "/p" })?.provider).toBe("claude");
  expect(record({ ...s, model: "gpt" })?.provider).toBe("codex");
  expect(record(s)?.provider).toBe("-");
  expect(record({ session_id: "s", model: "" })?.provider).toBe("-");
});

it("recordHook fields: reads the model and the effort from the payload or CLAUDE_EFFORT", () => {
  const s = { session_id: "s" };
  expect(record({ ...s, model: "fable 51" })?.model).toBe("fable 51");
  expect(record({ ...s, model: " " })?.model).toBe("-");
  expect(record({ ...s, effort: { level: "high" } })?.effort).toBe("high");
  expect(record({ ...s, effort: "low" })?.effort).toBe("low");
  expect(record({ ...s, effort: " " }, { CLAUDE_EFFORT: "max" })?.effort).toBe("max");
  expect(record(s, { CLAUDE_EFFORT: "max" })?.effort).toBe("max");
  expect(record(s, { CLAUDE_EFFORT: " " })?.effort).toBe("-");
  expect(record(s)?.effort).toBe("-");
});

it("recordHook fields: finds the session id, and writes nothing without one", () => {
  expect(record({ session_id: "a" })?.session).toBe("a");
  expect(record({ sessionId: "b" })?.session).toBe("b");
  expect(record({}, { GROK_SESSION_ID: "c" })?.session).toBe("c");
  expect(record(null, { GROK_SESSION_ID: "d" })?.session).toBe("d");
  expect(record({})).toBeNull();
  expect(record(null)).toBeNull();
  expect(record({ session_id: "default" })).toBeNull();
});

it("recordHook fields: finds the directory from the harness root, the payload or the project dir", () => {
  const s = { session_id: "s" };
  expect(record({ ...s, cwd: "/c" }, { GROK_WORKSPACE_ROOT: "/g" })?.cwd).toBe("/g");
  expect(record({ ...s, workspaceRoot: "/w1", cwd: "/c" })?.cwd).toBe("/w1");
  expect(record({ ...s, workspace_root: "/w2" })?.cwd).toBe("/w2");
  expect(record({ ...s, cwd: "/c" }, { CLAUDE_PROJECT_DIR: "/p" })?.cwd).toBe("/c");
  expect(record(s, { CLAUDE_PROJECT_DIR: "/p" })?.cwd).toBe("/p");
  expect(record(s)?.cwd).toBe(process.cwd());
  expect(record(null, { GROK_SESSION_ID: "g", CLAUDE_PROJECT_DIR: "/p" })?.cwd).toBe("/p");
});

it("recordHook fields: takes the work from prompt, userPrompt or user_prompt", () => {
  const s = { session_id: "s" };
  expect(record({ ...s, prompt: "one" })?.work).toBe("one");
  expect(record({ ...s, userPrompt: "two" })?.work).toBe("two");
  expect(record({ ...s, user_prompt: "three" })?.work).toBe("three");
  expect(record(s)?.work).toBe("active");
  expect(record(null, { GROK_SESSION_ID: "g" })?.work).toBe("active");
});

it("recordHook host: writes nothing when no host process can be identified", () => {
  expect(record({ session_id: "s" }, {}, { identity: null })).toBeNull();
});

it("recordHook host: finds the host by walking the real ancestry, and the boot id on its own", () => {
  const env = { REPO_BOARD_HOME: plantHome() };
  const walk = probeOf({ [process.pid]: { ppid: 40 }, 40: { comm: "claude", start: "400" } });
  const row = recordHook({ session_id: "s" }, env, { probe: walk, now: "T1" });
  expect(row).toMatchObject({ pid: 40, start: "400", boot: readBootId() });
  expect(recordHook({ session_id: "s" }, env, { probe: probeOf({}) })).toBeNull();
});

it("recordHook host: walks the real ancestry when nothing is injected, and writes nothing without a session", () => {
  const env = { REPO_BOARD_HOME: plantHome() };
  expect(recordHook({}, env)).toBeNull();
  const row = recordHook({ session_id: "s" }, env);
  expect(row === null || row.session === "s").toBe(true);
});

it("recordHook host: reads the environment itself when none is passed", () => {
  const home = plantHome();
  vi.stubEnv("REPO_BOARD_HOME", home);
  const row = recordHook({ session_id: "s" }, undefined, { ...deps, probe });
  expect(row?.session).toBe("s");
  expect(otherLines({ session_id: "t" }, undefined, { boot: BOOT, probe })).toContain(" s ");
});

it("recordHook host: fails open when the board cannot be written", () => {
  const home = plantHome();
  fs.mkdirSync(path.join(home, ".workerstack"));
  fs.writeFileSync(rowsDir(home), "a file where the directory belongs");
  expect(recordHook({ session_id: "s" }, { REPO_BOARD_HOME: home }, deps)).toBeNull();
});

it("otherLines: lists the other sessions' rows and leaves out this one", () => {
  const home = plantHome();
  const env = { REPO_BOARD_HOME: home, CLAUDE_PROJECT_DIR: "/p" };
  recordHook({ session_id: "mine", prompt: "my work" }, env, deps);
  recordHook({ session_id: "theirs", prompt: "their work" }, env, { ...deps, now: "T2" });
  const text = otherLines({ session_id: "mine" }, env, { boot: BOOT, probe });
  expect(text).toContain("their work");
  expect(text).not.toContain("my work");
});

it("otherLines: uses the machine boot id when none is given", () => {
  const home = plantHome();
  const self = probeProcess(process.pid);
  const env = { REPO_BOARD_HOME: home };
  recordHook({ session_id: "theirs" }, env, { identity: { pid: process.pid, start: self?.start ?? "" } });
  expect(otherLines({ session_id: "mine" }, env)).toContain(" theirs ");
});

it("otherLines: is empty when the board cannot be read", () => {
  const home = plantHome();
  fs.mkdirSync(path.join(home, ".workerstack"));
  fs.writeFileSync(rowsDir(home), "a file where the directory belongs");
  expect(otherLines({ session_id: "mine" }, { REPO_BOARD_HOME: home }, { boot: BOOT })).toBe("");
});
