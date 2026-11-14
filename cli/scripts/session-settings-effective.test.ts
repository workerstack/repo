import fs from "node:fs";

import { expect, it } from "vitest";

import type { AgentDefaults } from "../config-resolved.types.ts";
import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { plantFile } from "./__fixtures__/plant-file.ts";
import { effectiveSettings, setSessionStrategy, writeSessionSettings } from "./session-settings.ts";

const tmp = useTmp();

function temp(): string {
  return tmp.dir("session-settings-");
}

/** A plan with real frontmatter: the in-progress lookup reads `status:` and `approval:` from it. */
function planWith(status: string, approval: string): string {
  return `---\nstatus: ${status}\napproval: ${approval}\n---\n\n# x\n`;
}

const defaults: AgentDefaults = { defaultApproval: "ask", defaultEffort: "deep", defaultStrategy: "free" };

function data(ws: string, sid: string) {
  return { sessionId: sid, workspaceRoot: ws };
}

/** An in-progress plan this session saved, with `approval:` `approval`. */
function savePlan(ws: string, sid: string, approval: string): void {
  const body = planWith("in-progress", approval);
  const file = plantFile(ws, ".repo/plans/1-x.md", body);
  plantFile(ws, `.repo/tmp/sessions/${sid}/approvals.txt`, `${file}\n`);
}

it("falls to the built-in defaults the config names", () => {
  const ws = temp();
  expect(effectiveSettings(data(ws, "s1"), defaults)).toStrictEqual({
    approval: "ask",
    effort: "deep",
    strategy: "free",
  });

  expect(
    effectiveSettings(data(ws, "s1"), {
      defaultApproval: "away",
      defaultEffort: "fast",
      defaultStrategy: "spawn-deep",
    }),
  ).toStrictEqual({ approval: "away", effort: "fast", strategy: "spawn-deep" });
});

it("takes a session value over the config default, for each setting alone", () => {
  const ws = temp();
  writeSessionSettings(ws, "s1", { effort: "fast" });

  expect(effectiveSettings(data(ws, "s1"), defaults)).toStrictEqual({
    approval: "ask",
    effort: "fast",
    strategy: "free",
  });

  writeSessionSettings(ws, "s1", { approval: "away", strategy: "spawn-fast" });

  expect(
    effectiveSettings(data(ws, "s1"), { defaultApproval: "ask", defaultEffort: "deep", defaultStrategy: "spawn-deep" }),
  ).toStrictEqual({ approval: "away", effort: "fast", strategy: "spawn-fast" });
});

it("does not read another session's settings", () => {
  const ws = temp();
  writeSessionSettings(ws, "other", { approval: "away", effort: "fast", strategy: "spawn-fast" });
  expect(effectiveSettings(data(ws, "s1"), defaults)).toStrictEqual({
    approval: "ask",
    effort: "deep",
    strategy: "free",
  });
});

it("reads approval from the in-progress plan's approval: between the session value and the config default", () => {
  const ws = temp();
  savePlan(ws, "s1", "away");
  expect(effectiveSettings(data(ws, "s1"), defaults).approval).toBe("away");
  writeSessionSettings(ws, "s1", { approval: "ask" });
  expect(effectiveSettings(data(ws, "s1"), defaults).approval).toBe("ask");
});

it("lets an in-progress plan's approval: ask beat a config default of away", () => {
  const ws = temp();
  savePlan(ws, "s1", "ask");
  expect(effectiveSettings(data(ws, "s1"), { ...defaults, defaultApproval: "away" }).approval).toBe("ask");
});

it("leaves effort and strategy to the session value and the default, whatever the plan names", () => {
  const ws = temp();
  savePlan(ws, "s1", "away");
  expect(effectiveSettings(data(ws, "s1"), defaults)).toStrictEqual({
    approval: "away",
    effort: "deep",
    strategy: "free",
  });
});

it("ignores a plan that is not in progress", () => {
  const ws = temp();
  const file = plantFile(ws, ".repo/plans/1-x.md", planWith("ready", "away"));
  plantFile(ws, ".repo/tmp/sessions/s1/approvals.txt", `${file}\n`);
  expect(effectiveSettings(data(ws, "s1"), defaults).approval).toBe("ask");
});

it("gives the defaults to a payload with no session", () => {
  expect(effectiveSettings({ workspaceRoot: temp() }, defaults)).toStrictEqual({
    approval: "ask",
    effort: "deep",
    strategy: "free",
  });
});

it("sets the session strategy and says what changed", () => {
  const ws = temp();
  expect(setSessionStrategy(data(ws, "s1"), defaults, "spawn-fast")).toBe("set strategy spawn-fast (was free)");
  expect(effectiveSettings(data(ws, "s1"), defaults).strategy).toBe("spawn-fast");
});

it("writes no session strategy for a payload with no session id", () => {
  const ws = temp();
  expect(setSessionStrategy(data(ws, ""), defaults, "spawn-fast")).toBe("");
  expect(fs.existsSync(`${ws}/.repo/tmp/sessions`)).toBe(false);
});
