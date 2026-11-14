import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { hookSession, type Casing } from "./__fixtures__/hook-session.ts";
import { orchestrateKit } from "./__fixtures__/orchestrate-kit.ts";

const kit = orchestrateKit();
const CASINGS: readonly Casing[] = ["claude", "grok"];

// Roots and session come from the payload alone, as in a live session.
const UNSET = { CLAUDE_PROJECT_DIR: "", GROK_HOOK_EVENT: "", GROK_SESSION_ID: "", GROK_WORKSPACE_ROOT: "" };

const ALL = "ask, away, fast, deep, free, spawn-fast or spawn-deep";

function live(casing: Casing, sid: string) {
  const ws = kit.temp();

  return { s: hookSession(kit, { casing, env: UNSET, sid, ws }), ws };
}

function savedFile(ws: string, sid: string): string {
  return path.join(ws, ".repo/tmp/sessions", sid, "settings.json");
}

it.each(CASINGS)("/set away spawn-fast reports the change, then the next prompt shows all (%s payloads)", (casing) => {
  const { s } = live(casing, "t1");
  const ctx = s.say("/set away spawn-fast");
  expect(ctx).toContain("set approval away (was ask), strategy spawn-fast (was free)");
  expect(s.say("hello")).toMatch(/^approval=away effort=deep strategy=spawn-fast\. /);
});

it.each(CASINGS)("the first context of a session starts with all three settings (%s payloads)", (casing) => {
  const { s } = live(casing, "t2");
  expect(s.say("hello")).toMatch(/^approval=ask effort=deep strategy=free/);
});

it("the change line is a line of its own, and the settings line already shows the new values", () => {
  const { s } = live("claude", "t3");
  const lines = s.say("/set fast").split("\n");
  expect(lines[0]).toMatch(/^approval=ask effort=fast strategy=free/);
  expect(lines).toContain("set effort fast (was deep)");
});

it("a later /set keeps the settings an earlier one saved", () => {
  const { s } = live("claude", "t4");
  s.say("/set away");
  s.say("/set fast");
  s.say("/set spawn-deep");
  expect(s.say("hello")).toMatch(/^approval=away effort=fast strategy=spawn-deep\b/);
});

it("/ask after /set away gives approval=ask and keeps the other settings", () => {
  const { s } = live("claude", "t5");
  s.say("/set away deep spawn-fast");
  expect(s.say("/ask")).toMatch(/^approval=ask effort=deep strategy=spawn-fast\b/);
  expect(s.say("go")).toMatch(/^approval=ask effort=deep strategy=spawn-fast\b/);
});

it("/away after /set ask gives approval=away", () => {
  const { s } = live("claude", "t6");
  s.say("/set ask");
  expect(s.say("/away")).toMatch(/^approval=away\b/);
});

it("away set by /set makes Stop block a reply that ends in a question", () => {
  const { s } = live("claude", "t7");
  s.say("/set away");
  expect(s.stop("Keep --json or add --format=json?\n")?.decision).toBe("block");
});

it("a /set with every setting already held says no change", () => {
  const { s } = live("claude", "t8");
  s.say("/set away");
  expect(s.say("/set away")).toContain("set: no change; approval is already away");
});

it.each([
  ["/set fsat", `set: "fsat" is not a setting; use ${ALL}`],
  ["/set fast deep", "set: fast and deep both set effort; pick one"],
  ["/set", `set: name a setting: ${ALL}`],
  ["/set   ", `set: name a setting: ${ALL}`],
])("%j gives its usage line and saves nothing", (prompt, line) => {
  const { s, ws } = live("claude", "t9");
  expect(s.say(prompt)).toContain(line);
  expect(fs.existsSync(savedFile(ws, "t9"))).toBe(false);
  expect(s.say("hello")).toMatch(/^approval=ask effort=deep strategy=free\b/);
});

it("a bad /set after a good one leaves the saved settings as they were", () => {
  const { s, ws } = live("claude", "t10");
  s.say("/set away");
  const before = fs.readFileSync(savedFile(ws, "t10"), "utf8");
  s.say("/set fast bogus");
  expect(fs.readFileSync(savedFile(ws, "t10"), "utf8")).toBe(before);
});

it.each(["please /set away", "/setx away", "/settle away"])("%j is no /set and saves nothing", (prompt) => {
  const { s, ws } = live("claude", "t11");
  s.say(prompt);
  expect(fs.existsSync(savedFile(ws, "t11"))).toBe(false);
});

it("settings are per session: another session keeps its own", () => {
  const ws = kit.temp();
  const a = hookSession(kit, { casing: "claude", env: UNSET, sid: "ta", ws });
  const b = hookSession(kit, { casing: "claude", env: UNSET, sid: "tb", ws });
  a.say("/set away fast");
  expect(b.say("hello")).toMatch(/^approval=ask effort=deep strategy=free\b/);
  expect(a.say("hello")).toMatch(/^approval=away effort=fast strategy=free\b/);
});
