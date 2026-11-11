import { expect, it } from "vitest";

import { CONFIG } from "./__fixtures__/copied-install.ts";
import { REMOVAL, firstWritten, mini, notes, planOf } from "./__fixtures__/mini-install.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { applyMigration } from "./apply-migration.ts";
import type { MigrateDeps } from "./migrate.ts";
import { HOOK_COMMANDS_KEY, hashText } from "./stock-history.ts";

useTempDirs();

const stockGroup = { hooks: [{ command: "stock-cmd", timeout: 5, type: "command" }], matcher: "Bash" };
const stockSettings = JSON.stringify({ hooks: { PreToolUse: [stockGroup] } });
const opts = { generated: { ".claude/settings.json": stockSettings } };
const TO = ".repo/settings/claude.json";
const mine = { hooks: [{ command: "mine", type: "command" }], matcher: "Edit" };
/** A Bash group holding the stock command and one of the consumer's own. */
const mixed = {
  hooks: [
    { command: "stock-cmd", timeout: 5, type: "command" },
    { command: "mine-too", type: "command" },
  ],
  matcher: "Bash",
};
/** Settings with an own key, the stock group, a mixed group, an own group and a hook only an older stock ran. */
const OWN_SETTINGS = JSON.stringify({
  hooks: {
    PostToolUse: [mine],
    PreToolUse: [stockGroup, mixed],
    Stop: [{ hooks: [{ command: "old stock", type: "command" }], matcher: "*" }],
  },
  permissions: { allow: ["X"] },
});

it("carries hook groups and commands that no stock version ran, under the same event", async () => {
  const m = mini({ ".claude/settings.json": OWN_SETTINGS }, opts);
  const deps: MigrateDeps = { history: { [HOOK_COMMANDS_KEY]: [hashText("old stock")] } };
  const steps = planOf(m, CONFIG, deps);
  expect(notes(steps).slice(0, 1)).toStrictEqual([
    [
      `moved your .claude/settings.json keys permissions to ${TO}`,
      `moved your .claude/settings.json hooks PostToolUse (1) to ${TO}`,
      `moved your .claude/settings.json hooks PreToolUse (1) to ${TO}`,
    ].join("\n"),
  ]);
  expect(firstWritten(steps)).toStrictEqual({
    hooks: {
      PostToolUse: [mine],
      PreToolUse: [{ hooks: [{ command: "mine-too", type: "command" }], matcher: "Bash" }],
    },
    permissions: { allow: ["X"] },
  });
  const lines = await applyMigration(m.root, steps);
  expect(lines.slice(0, 3)).toStrictEqual([
    `repo sync: moved your .claude/settings.json keys permissions to ${TO}`,
    `repo sync: moved your .claude/settings.json hooks PostToolUse (1) to ${TO}`,
    `repo sync: moved your .claude/settings.json hooks PreToolUse (1) to ${TO}`,
  ]);
});

it("carries only hooks when nothing else is new, and plans nothing when every command is stock", () => {
  const own = { command: "mine", type: "command" };
  const only = mini(
    { ".claude/settings.json": JSON.stringify({ hooks: { PostToolUse: [{ hooks: [own], matcher: "x" }] } }) },
    opts,
  );
  expect(notes(planOf(only, CONFIG, { history: {} }))).toStrictEqual([
    `moved your .claude/settings.json hooks PostToolUse (1) to ${TO}`,
  ]);
  const stockOnly = mini({ ".claude/settings.json": JSON.stringify({ hooks: { PreToolUse: [stockGroup] } }) }, opts);
  expect(planOf(stockOnly, CONFIG, { history: {} })).toStrictEqual([REMOVAL]);
});

it("carries a group or an event value it cannot read as it is, and a hook with no command", () => {
  const m = mini(
    {
      ".claude/settings.json": JSON.stringify({
        hooks: { A: ["text"], B: "odd", C: [{ hooks: [{ type: "prompt" }], matcher: "m" }], D: [{ matcher: "m" }] },
      }),
    },
    opts,
  );
  expect(firstWritten(planOf(m, CONFIG, { history: {} }))).toStrictEqual({
    hooks: { A: ["text"], B: ["odd"], C: [{ hooks: [{ type: "prompt" }], matcher: "m" }], D: [{ matcher: "m" }] },
  });
  const notObject = mini({ ".claude/settings.json": JSON.stringify({ env: { Z: "1" }, hooks: "nope" }) }, opts);
  expect(notes(planOf(notObject, CONFIG, { history: {} }))).toStrictEqual([
    `moved your .claude/settings.json keys env to ${TO}`,
  ]);
});
