import { expect, it } from "vitest";
import { applyMigration } from "./apply-migration.ts";
import type { MigrateDeps } from "./migrate.ts";
import { HOOK_COMMANDS_KEY, hashText } from "./stock-history.ts";
import { CONFIG } from "./fixtures/copied-install.ts";
import { REMOVAL, firstWritten, mini, notes, planOf } from "./fixtures/mini-install.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();

const stockGroup = { matcher: "Bash", hooks: [{ type: "command", command: "stock-cmd", timeout: 5 }] };
const stockSettings = JSON.stringify({ hooks: { PreToolUse: [stockGroup] } });
const opts = { generated: { ".claude/settings.json": stockSettings } };
const TO = ".repo/settings/claude.json";
const mine = { matcher: "Edit", hooks: [{ type: "command", command: "mine" }] };
/** A Bash group holding the stock command and one of the consumer's own. */
const mixed = {
  matcher: "Bash",
  hooks: [
    { type: "command", command: "stock-cmd", timeout: 5 },
    { type: "command", command: "mine-too" },
  ],
};
/** Settings with an own key, the stock group, a mixed group, an own group and a hook only an older stock ran. */
const OWN_SETTINGS = JSON.stringify({
  permissions: { allow: ["X"] },
  hooks: {
    PreToolUse: [stockGroup, mixed],
    PostToolUse: [mine],
    Stop: [{ matcher: "*", hooks: [{ type: "command", command: "old stock" }] }],
  },
});

it("carries hook groups and commands that no stock version ran, under the same event", async () => {
  const m = mini({ ".claude/settings.json": OWN_SETTINGS }, opts);
  const deps: MigrateDeps = { history: { [HOOK_COMMANDS_KEY]: [hashText("old stock")] } };
  const steps = planOf(m, CONFIG, deps);
  expect(notes(steps).slice(0, 1)).toEqual([
    `moved your .claude/settings.json keys permissions to ${TO}\nmoved your .claude/settings.json hooks PreToolUse (1) to ${TO}\nmoved your .claude/settings.json hooks PostToolUse (1) to ${TO}`,
  ]);
  expect(firstWritten(steps)).toEqual({
    permissions: { allow: ["X"] },
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "mine-too" }] }],
      PostToolUse: [mine],
    },
  });
  expect((await applyMigration(m.root, steps)).slice(0, 3)).toEqual([
    `repo sync: moved your .claude/settings.json keys permissions to ${TO}`,
    `repo sync: moved your .claude/settings.json hooks PreToolUse (1) to ${TO}`,
    `repo sync: moved your .claude/settings.json hooks PostToolUse (1) to ${TO}`,
  ]);
});

it("carries only hooks when nothing else is new, and plans nothing when every command is stock", () => {
  const own = { type: "command", command: "mine" };
  const only = mini(
    { ".claude/settings.json": JSON.stringify({ hooks: { PostToolUse: [{ matcher: "x", hooks: [own] }] } }) },
    opts,
  );
  expect(notes(planOf(only, CONFIG, { history: {} }))).toEqual([
    `moved your .claude/settings.json hooks PostToolUse (1) to ${TO}`,
  ]);
  const stockOnly = mini({ ".claude/settings.json": JSON.stringify({ hooks: { PreToolUse: [stockGroup] } }) }, opts);
  expect(planOf(stockOnly, CONFIG, { history: {} })).toEqual([REMOVAL]);
});

it("carries a group or an event value it cannot read as it is, and a hook with no command", () => {
  const m = mini(
    {
      ".claude/settings.json": JSON.stringify({
        hooks: { A: ["text"], B: "odd", C: [{ matcher: "m", hooks: [{ type: "prompt" }] }], D: [{ matcher: "m" }] },
      }),
    },
    opts,
  );
  expect(firstWritten(planOf(m, CONFIG, { history: {} }))).toEqual({
    hooks: { A: ["text"], B: ["odd"], C: [{ matcher: "m", hooks: [{ type: "prompt" }] }], D: [{ matcher: "m" }] },
  });
  const notObject = mini({ ".claude/settings.json": JSON.stringify({ hooks: "nope", env: { Z: "1" } }) }, opts);
  expect(notes(planOf(notObject, CONFIG, { history: {} }))).toEqual([
    `moved your .claude/settings.json keys env to ${TO}`,
  ]);
});
